import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, computed, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LivenessSummary } from '../models/liveness-result.model';

type HistorySource = 'local' | 'remote';

export interface LivenessHistoryApiCapture {
  key: string;
  url: string;
  position?: string;
  size: number;
  lastModified: string;
}

export interface LivenessHistoryApiVideo {
  key: string;
  url: string;
  mimeType: string;
  size: number;
  durationSeconds?: number;
}

export interface LivenessHistoryApiItem {
  sessionId: string;
  createdAt: string;
  livenessScore?: number;
  status?: string;
  documentKey?: string;
  documentUrl?: string;
  documentName?: string;
  captures: LivenessHistoryApiCapture[];
  video?: LivenessHistoryApiVideo;
  metadata?: Record<string, string>;
}

export interface LivenessHistoryEntry {
  id: string;
  sessionId: string;
  createdAt: string;
  summary: LivenessSummary;
  source: HistorySource;
  metadata?: Record<string, string>;
}

@Injectable({
  providedIn: 'root'
})
export class LivenessHistoryService {
  private readonly storageKey = 'dayfusion:liveness-history';
  private readonly maxEntries = 50;
  private readonly historySignal = signal<LivenessHistoryEntry[]>([]);

  readonly history: Signal<LivenessHistoryEntry[]>;

  constructor(private readonly http: HttpClient) {
    const stored = this.loadFromStorage();
    this.historySignal.set(stored);
    this.history = computed(() => this.historySignal());
    void this.fetchRemoteHistory().catch(() => {});
  }

  addEntry(summary: LivenessSummary): LivenessHistoryEntry {
    const clonedSummary = this.cloneSummary(summary);
    const entry: LivenessHistoryEntry = {
      id: this.generateId(),
      sessionId: clonedSummary.sessionId,
      createdAt: clonedSummary.createdAt,
      summary: clonedSummary,
      source: 'local',
      metadata: clonedSummary.metadata
    };

    this.historySignal.update((current) => {
      const updated = this.mergeEntries(current, [entry]);
      this.saveToStorage(updated.filter(item => item.source === 'local'));
      return updated;
    });

    return entry;
  }

  clear(): void {
    this.historySignal.update(current => current.filter(entry => entry.source === 'remote'));
    this.saveToStorage([]);
  }

  getEntryById(id: string): LivenessHistoryEntry | undefined {
    return this.historySignal().find(entry => entry.id === id);
  }

  async refreshRemote(limit = 20, expiryMinutes = 60): Promise<void> {
    await this.fetchRemoteHistory(limit, expiryMinutes);
  }

  private async fetchRemoteHistory(limit = 20, expiryMinutes = 60): Promise<void> {
    const baseUrl = environment.apiUrl?.replace(/\/$/, '') ?? '';
    if (!baseUrl) {
      return;
    }

    try {
      //const endpoint = `${baseUrl}/liveness/history?limit=${limit}&expiryMinutes=${expiryMinutes}`;
      //const items = await firstValueFrom(this.http.get<LivenessHistoryApiItem[]>(endpoint));
      //const remoteEntries = items.map((item) => this.mapRemoteItem(item));
      //this.historySignal.update((current) => this.mergeEntries(current, remoteEntries));
    } catch (error) {
      throw error;
    }
  }

  private mergeEntries(current: LivenessHistoryEntry[], incoming: LivenessHistoryEntry[]): LivenessHistoryEntry[] {
    const map = new Map<string, LivenessHistoryEntry>();

    for (const entry of current) {
      map.set(entry.sessionId, entry);
    }

    for (const entry of incoming) {
      const existing = map.get(entry.sessionId);
      if (!existing || existing.source !== 'local') {
        map.set(entry.sessionId, entry);
      }
    }

    return Array.from(map.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, this.maxEntries);
  }

  private mapRemoteItem(item: LivenessHistoryApiItem): LivenessHistoryEntry {
    const createdAt = item.createdAt ?? new Date().toISOString();
    const livenessScore = Number(item.livenessScore ?? 0);
    const status = this.normalizeStatus(item.status);
    const isLive = this.computeIsLive(status, livenessScore);

    const summary: LivenessSummary = {
      sessionId: item.sessionId,
      createdAt,
      isLive,
      livenessScore,
      faceMatchScore: undefined,
      status,
      captures: (item.captures ?? []).map(capture => ({
        position: capture.position ?? this.inferPositionFromKey(capture.key),
        confidence: this.extractConfidence(item.metadata, capture.position ?? capture.key),
        s3Key: capture.key,
        previewUrl: capture.url
      })),
      video: item.video
        ? {
            s3Key: item.video.key,
            url: item.video.url,
            mimeType: item.video.mimeType,
            size: item.video.size,
            durationMs: (item.video.durationSeconds ?? 0) * 1000
          }
        : undefined,
      documentKey: item.documentKey ?? item.metadata?.['documentKey'],
      documentName: item.documentName ?? item.metadata?.['documentName'],
      metadata: item.metadata
    };

    if (item.documentUrl ?? item.metadata?.['documentUrl']) {
      summary.metadata = {
        ...(summary.metadata ?? {}),
        documentUrl: item.documentUrl ?? item.metadata?.['documentUrl'] ?? ''
      };
    }

    if (summary.documentKey && !summary.documentName) {
      summary.documentName = summary.documentKey.split('/').pop() ?? summary.documentKey;
    }

    return {
      id: this.generateId(),
      sessionId: item.sessionId,
      createdAt,
      summary,
      source: 'remote',
      metadata: item.metadata
    };
  }

  private normalizeStatus(status?: string): 'Aprovado' | 'Rejeitado' | 'Revisar' {
    const normalized = status?.toLowerCase() ?? '';
    if (normalized.includes('aprov') || normalized.includes('live')) {
      return 'Aprovado';
    }
    if (normalized.includes('rejeit') || normalized.includes('fail') || normalized.includes('spoof')) {
      return 'Rejeitado';
    }
    return 'Revisar';
  }

  private computeIsLive(status: 'Aprovado' | 'Rejeitado' | 'Revisar', livenessScore: number): boolean {
    if (status === 'Aprovado') {
      return true;
    }
    if (status === 'Rejeitado') {
      return false;
    }
    return livenessScore >= 70;
  }

  private inferPositionFromKey(key: string): string {
    const lower = key.toLowerCase();
    if (lower.includes('frente') || lower.includes('front')) {
      return 'frente';
    }
    if (lower.includes('esquerda') || lower.includes('left')) {
      return 'esquerda';
    }
    if (lower.includes('direita') || lower.includes('right')) {
      return 'direita';
    }
    if (lower.includes('cima') || lower.includes('top')) {
      return 'cima';
    }
    if (lower.includes('baixo') || lower.includes('down')) {
      return 'baixo';
    }
    return 'captura';
  }

  private extractConfidence(metadata: Record<string, string> | undefined, position: string): number {
    if (!metadata) {
      return 0;
    }
    const normalizedPosition = position.toLowerCase().replace(/\s+/g, '');
    const keys = [
      `confidence:${normalizedPosition}`,
      `confidence_${normalizedPosition}`,
      `confidence-${normalizedPosition}`
    ];
    for (const key of keys) {
      const value = metadata[key];
      if (value !== undefined) {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    }
    return 0;
  }

  private loadFromStorage(): LivenessHistoryEntry[] {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const stored = window.localStorage.getItem(this.storageKey);
      if (!stored) {
        return [];
      }
      const parsed = JSON.parse(stored) as Array<Partial<LivenessHistoryEntry>>;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((entry) => this.sanitizeEntry(entry))
        .filter((entry): entry is LivenessHistoryEntry => Boolean(entry));
    } catch (error) {
      return [];
    }
  }

  private saveToStorage(history: LivenessHistoryEntry[]): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(history));
    } catch (error) {
    }
  }

  private cloneSummary(summary: LivenessSummary): LivenessSummary {
    try {
      return structuredClone(summary);
    } catch {
      return JSON.parse(JSON.stringify(summary)) as LivenessSummary;
    }
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private sanitizeEntry(entry: Partial<LivenessHistoryEntry>): LivenessHistoryEntry | null {
    if (!entry || !entry.summary) {
      return null;
    }

    const summary = entry.summary as LivenessSummary;
    if (!summary.sessionId) {
      return null;
    }

    return {
      id: entry.id ?? this.generateId(),
      sessionId: summary.sessionId,
      createdAt: summary.createdAt ?? entry.createdAt ?? new Date().toISOString(),
      summary,
      source: 'local',
      metadata: entry.metadata
    };
  }
}

