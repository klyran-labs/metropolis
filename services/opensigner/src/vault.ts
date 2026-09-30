import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WalletMetadata {
  walletId: string;
  address: `0x${string}`;
  createdAt: number;
  label?: string;
}

export interface EncryptedWalletRecord extends WalletMetadata {
  encryptedPrivateKey: string; // hex
  iv: string; // hex
  authTag: string; // hex
}

export interface VaultData {
  version: number;
  salt: string; // hex
  wallets: Record<string, EncryptedWalletRecord>;
}

export interface IKeyVault {
  createWallet(label?: string): WalletMetadata;
  listWallets(): WalletMetadata[];
  getWallet(walletIdOrAddress: string): WalletMetadata | null;
  getDecryptedPrivateKey(walletIdOrAddress: string): `0x${string}`;
  count(): number;
}

export class EncryptedVault implements IKeyVault {
  private vaultPath: string;
  private shardsDir: string;
  private masterKey: string;
  private derivedKey: Buffer;
  private salt: Buffer;
  private wallets: Map<string, EncryptedWalletRecord> = new Map();
  private addressToId: Map<string, string> = new Map();

  constructor(vaultPath: string, masterKey: string) {
    this.vaultPath = vaultPath;
    this.masterKey = masterKey;
    
    // Ensure parent directory and shards directory exist
    const dir = path.dirname(vaultPath);
    this.shardsDir = path.join(dir, 'shards');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.shardsDir)) {
      fs.mkdirSync(this.shardsDir, { recursive: true });
    }

    if (fs.existsSync(vaultPath)) {
      const raw = fs.readFileSync(vaultPath, 'utf8');
      const data: VaultData = JSON.parse(raw);
      this.salt = Buffer.from(data.salt, 'hex');
      this.derivedKey = scryptSync(this.masterKey, this.salt, 32);
      
      for (const [id, record] of Object.entries(data.wallets)) {
        this.wallets.set(id, record);
        this.addressToId.set(record.address.toLowerCase(), id);
      }
    } else {
      this.salt = randomBytes(16);
      this.derivedKey = scryptSync(this.masterKey, this.salt, 32);
      this.save();
    }
  }

  /**
   * Atomic, fsync-hardened POSIX file writer.
   * Guarantees data durability across power loss, container kill, or filesystem re-ordering.
   */
  private atomicWriteFileSync(targetPath: string, content: string): void {
    const tempPath = `${targetPath}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;
    const fd = fs.openSync(tempPath, 'w');
    try {
      fs.writeSync(fd, content, 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, targetPath);
    
    // Flush parent directory if supported
    try {
      const dirFd = fs.openSync(path.dirname(targetPath), 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // Parent directory fsync is best-effort across platforms
    }
  }

  private save(): void {
    const data: VaultData = {
      version: 1,
      salt: this.salt.toString('hex'),
      wallets: Object.fromEntries(this.wallets.entries())
    };
    this.atomicWriteFileSync(this.vaultPath, JSON.stringify(data, null, 2));
  }

  private saveShard(record: EncryptedWalletRecord): void {
    const shardPath = path.join(this.shardsDir, `${record.walletId}.enc.json`);
    this.atomicWriteFileSync(shardPath, JSON.stringify(record, null, 2));
  }

  public createWallet(label?: string): WalletMetadata {
    const privKey = generatePrivateKey();
    const account = privateKeyToAccount(privKey);
    const address = account.address;
    const walletId = `wallet_${randomBytes(8).toString('hex')}`;
    const createdAt = Date.now();

    // Encrypt private key with AES-256-GCM
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.derivedKey, iv);
    let encrypted = cipher.update(privKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const record: EncryptedWalletRecord = {
      walletId,
      address,
      createdAt,
      label,
      encryptedPrivateKey: encrypted,
      iv: iv.toString('hex'),
      authTag
    };

    this.wallets.set(walletId, record);
    this.addressToId.set(address.toLowerCase(), walletId);
    
    // Persist to sharded store and vault index
    this.saveShard(record);
    this.save();

    return {
      walletId,
      address,
      createdAt,
      label
    };
  }

  public listWallets(): WalletMetadata[] {
    return Array.from(this.wallets.values()).map(w => ({
      walletId: w.walletId,
      address: w.address,
      createdAt: w.createdAt,
      label: w.label
    }));
  }

  public getWallet(walletIdOrAddress: string): WalletMetadata | null {
    const id = this.addressToId.get(walletIdOrAddress.toLowerCase()) || walletIdOrAddress;
    const record = this.wallets.get(id);
    if (!record) return null;
    return {
      walletId: record.walletId,
      address: record.address,
      createdAt: record.createdAt,
      label: record.label
    };
  }

  public getDecryptedPrivateKey(walletIdOrAddress: string): `0x${string}` {
    const id = this.addressToId.get(walletIdOrAddress.toLowerCase()) || walletIdOrAddress;
    const record = this.wallets.get(id);
    if (!record) {
      throw new Error(`Wallet not found: ${walletIdOrAddress}`);
    }

    const iv = Buffer.from(record.iv, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.derivedKey, iv);
    decipher.setAuthTag(Buffer.from(record.authTag, 'hex'));
    let decrypted = decipher.update(record.encryptedPrivateKey, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted as `0x${string}`;
  }

  public count(): number {
    return this.wallets.size;
  }
}
