/**
 * Vendor-Neutral DNS Provider Abstraction for RemoteNode Server Endpoints
 * (Handles subdomain allocation and verification behind clean interfaces)
 */

export interface DnsRecord {
  hostname: string;
  target: string;
  type: 'CNAME' | 'A';
  ttl?: number;
}

export interface DnsProvisionResult {
  success: boolean;
  recordId?: string;
  hostname: string;
  error?: string;
}

export interface DnsProvider {
  provisionRecord(record: DnsRecord): Promise<DnsProvisionResult>;
  removeRecord(hostname: string): Promise<{ success: boolean; error?: string }>;
  verifyRecord(hostname: string): Promise<boolean>;
}

/**
 * In-Memory Mock DNS Provider for Development & Automated Testing
 * (No live external DNS mutation or credentials required)
 */
export class MockDnsProvider implements DnsProvider {
  private records: Map<string, DnsRecord> = new Map();

  async provisionRecord(record: DnsRecord): Promise<DnsProvisionResult> {
    if (!record.hostname || !record.target) {
      return {
        success: false,
        hostname: record.hostname,
        error: 'Hostname and target are required'
      };
    }

    this.records.set(record.hostname, record);
    return {
      success: true,
      recordId: `mock-dns-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      hostname: record.hostname
    };
  }

  async removeRecord(hostname: string): Promise<{ success: boolean; error?: string }> {
    const deleted = this.records.delete(hostname);
    return { success: deleted };
  }

  async verifyRecord(hostname: string): Promise<boolean> {
    return this.records.has(hostname);
  }

  getRecordCount(): number {
    return this.records.size;
  }
}
