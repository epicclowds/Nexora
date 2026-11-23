import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import maxmind, { type AsnResponse, type CityResponse, type Reader } from 'maxmind';
import { AppConfig } from '../config/app-config';

export interface GeoResult {
  countryCode: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  isp: string | null;
}

/** Private, loopback, link-local and CGNAT ranges are never looked up. */
export function isPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    return !(lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('::ffff:'));
  }
  return false;
}

/**
 * Optional, offline IP geolocation using MaxMind GeoLite2 databases (City and
 * ASN). Results are approximate by nature and are presented as such. When no
 * database is configured, no location data is stored.
 */
@Injectable()
export class GeoIpService implements OnModuleInit {
  private readonly logger = new Logger(GeoIpService.name);
  private city: Reader<CityResponse> | null = null;
  private asn: Reader<AsnResponse> | null = null;

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    this.city = await this.open<CityResponse>(this.config.env.GEOIP_CITY_DB, 'City');
    this.asn = await this.open<AsnResponse>(this.config.env.GEOIP_ASN_DB, 'ASN');
  }

  get enabled(): boolean {
    return this.city !== null || this.asn !== null;
  }

  lookup(ip: string | null | undefined): GeoResult | null {
    if (!ip || !this.enabled || !isPublicIp(ip)) return null;
    try {
      const city = this.city?.get(ip) ?? null;
      const asn = this.asn?.get(ip) ?? null;
      return {
        countryCode: city?.country?.iso_code ?? city?.registered_country?.iso_code ?? null,
        region: city?.subdivisions?.[0]?.names?.en ?? null,
        city: city?.city?.names?.en ?? null,
        asn: asn?.autonomous_system_number ?? null,
        isp: asn?.autonomous_system_organization ?? null,
      };
    } catch {
      return null;
    }
  }

  private async open<T extends CityResponse | AsnResponse>(path: string | undefined, label: string): Promise<Reader<T> | null> {
    if (!path) return null;
    if (!existsSync(path)) {
      this.logger.warn(`GeoIP ${label} database not found at ${path}; location data is disabled`);
      return null;
    }
    try {
      const reader = await maxmind.open<T>(path, { watchForUpdates: true });
      this.logger.log(`GeoIP ${label} database loaded`);
      return reader;
    } catch (err) {
      this.logger.warn(`Could not open GeoIP ${label} database: ${(err as Error).message}`);
      return null;
    }
  }
}
