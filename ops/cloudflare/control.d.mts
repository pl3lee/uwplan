export function assertNonProductionZone(zoneName: string): string;
export function assertWorkerCapacity(values: {
  used: number;
  limit: number;
  reserved?: number;
}): {
  used: number;
  limit: number;
  reserved: number;
  remainingAfterReservation: number;
};
export class CloudflareApi {
  constructor(options: {
    token: string;
    fetchImpl?: typeof fetch;
    baseUrl?: string;
  });
  verifyToken(accountId?: string): Promise<Record<string, unknown>>;
  getZone(zoneId: string): Promise<any>;
  listDnsRecords(zoneId: string, hostname: string): Promise<any[]>;
  getDnsRecord(zoneId: string, recordId: string): Promise<any>;
  patchDnsRecord(
    zoneId: string,
    recordId: string,
    patch: Record<string, unknown>,
  ): Promise<any>;
  getSslMode(zoneId: string): Promise<any>;
}
export interface OriginRecordSnapshot {
  id: string;
  zone_id?: string;
  zone_name?: string;
  name: string;
  type: string;
  proxiable?: boolean;
  content: string;
  proxied: boolean;
  ttl: number;
  meta: Record<string, unknown>;
  comment: string | null;
  tags: string[];
  settings: Record<string, unknown>;
  created_on?: string;
  comment_modified_on?: string;
  tags_modified_on?: string;
}
export interface OriginSnapshot {
  schemaVersion: number;
  zoneId: string;
  zoneName: string;
  capturedAt: string;
  records: OriginRecordSnapshot[];
}
export function captureOriginRecords(options: any): Promise<OriginSnapshot>;
export function switchOriginRecords(options: any): Promise<any>;
export function verifyOriginTls(options: any): Promise<any>;
export function verifyShortLivedToken(
  result: any,
  options?: { now?: number; maximumLifetimeMs?: number },
): { id: string; expiresAt: string };
export function verifyReadinessUrl(
  fetchImpl: typeof fetch,
  url: string,
  expected?: { digest?: string; revision?: string },
): Promise<any>;
export function readProtectedSecret(path: string): Promise<string>;
export function writePrivateJson(path: string, value: unknown): Promise<void>;
