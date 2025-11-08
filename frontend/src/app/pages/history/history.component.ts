import { CommonModule } from '@angular/common';
import { Component, Signal, computed, effect, signal } from '@angular/core';
import { LivenessSummary } from '../../core/models/liveness-result.model';
import { LivenessHistoryEntry, LivenessHistoryService } from '../../core/services/liveness-history.service';
import { S3Service } from '../../core/aws/s3.service';

interface EntryMediaCache {
  captureUrls: Record<string, string>;
  videoUrl?: string;
  loadedAt: number;
}

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.scss']
})
export class HistoryComponent {
  private readonly mediaCacheSignal = signal<Record<string, EntryMediaCache>>({});

  readonly historyEntries: Signal<LivenessHistoryEntry[]>;
  readonly selectedEntryId = signal<string | null>(null);
  readonly loadingMedia = signal(false);
  readonly syncingHistory = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly selectedEntry = computed<LivenessHistoryEntry | null>(() => {
    const id = this.selectedEntryId();
    return this.historyEntries().find(entry => entry.id === id) ?? null;
  });

  constructor(
    private readonly historyService: LivenessHistoryService,
    private readonly s3Service: S3Service
  ) {
    this.historyEntries = this.historyService.history;

    effect(() => {
      const entries = this.historyEntries();
      if (!this.selectedEntryId() && entries.length) {
        void this.selectEntry(entries[0].id);
      }
      if (!entries.length) {
        this.selectedEntryId.set(null);
      }
    });

    void this.syncHistory();
  }

  trackByEntry(_: number, entry: LivenessHistoryEntry): string {
    return entry.id;
  }

  trackByCapture(_: number, capture: LivenessSummary['captures'][number]): string {
    return capture.s3Key;
  }

  getCaptureUrl(entryId: string, capture: LivenessSummary['captures'][number]): string | undefined {
    return this.mediaCacheSignal()[entryId]?.captureUrls?.[capture.s3Key] ?? capture.previewUrl;
  }

  getVideoUrl(entryId: string, video: NonNullable<LivenessSummary['video']>): string | undefined {
    return this.mediaCacheSignal()[entryId]?.videoUrl ?? video.url;
  }

  async selectEntry(entryId: string, refresh = true): Promise<void> {
    this.selectedEntryId.set(entryId);
    if (refresh) {
      await this.ensureMediaUrls(entryId, false);
    }
  }

  async refreshSelected(): Promise<void> {
    const entryId = this.selectedEntryId();
    if (!entryId) {
      return;
    }
    await this.ensureMediaUrls(entryId, true);
  }

  async syncHistory(): Promise<void> {
    if (this.syncingHistory()) {
      return;
    }
    this.syncingHistory.set(true);
    this.loadError.set(null);
    try {
      await this.historyService.refreshRemote();
      const entries = this.historyEntries();
      if (entries.length && !this.selectedEntryId()) {
        await this.selectEntry(entries[0].id, false);
      }
    } catch (error) {
      console.error('[HistoryComponent] Falha ao sincronizar histórico.', error);
      this.loadError.set('Não foi possível sincronizar o histórico com o backend.');
    } finally {
      this.syncingHistory.set(false);
    }
  }

  async openCapture(entry: LivenessHistoryEntry, capture: LivenessSummary['captures'][number], event: Event): Promise<void> {
    event.stopPropagation();
    try {
      const url = await this.s3Service.getSignedUrl(capture.s3Key);
      window.open(url, '_blank');
    } catch (error) {
      console.error('[HistoryComponent] Falha ao abrir captura.', error);
      this.loadError.set('Não foi possível abrir a captura selecionada.');
    }
  }

  async openVideo(entry: LivenessHistoryEntry, event: Event): Promise<void> {
    event.stopPropagation();
    const video = entry.summary.video;
    if (!video?.s3Key) {
      return;
    }
    try {
      const url = await this.s3Service.getSignedUrl(video.s3Key);
      window.open(url, '_blank');
    } catch (error) {
      console.error('[HistoryComponent] Falha ao abrir vídeo.', error);
      this.loadError.set('Não foi possível abrir o vídeo da sessão.');
    }
  }

  clearHistory(): void {
    this.historyService.clear();
    this.mediaCacheSignal.set({});
  }

  private async ensureMediaUrls(entryId: string, force: boolean): Promise<void> {
    const entry = this.historyEntries().find(item => item.id === entryId);
    if (!entry) {
      return;
    }

    const cached = this.mediaCacheSignal()[entryId];
    if (!force && cached && Date.now() - cached.loadedAt < 5 * 60 * 1000) {
      return;
    }

    this.loadingMedia.set(true);
    this.loadError.set(null);

    const captureUrls: Record<string, string> = { ...(cached?.captureUrls ?? {}) };
    let videoUrl = cached?.videoUrl;

    try {
      for (const capture of entry.summary.captures) {
        if (!capture.s3Key) {
          continue;
        }
        captureUrls[capture.s3Key] = await this.s3Service.getSignedUrl(capture.s3Key);
      }

      if (entry.summary.video?.s3Key) {
        videoUrl = await this.s3Service.getSignedUrl(entry.summary.video.s3Key);
      }

      this.mediaCacheSignal.update((state) => ({
        ...state,
        [entryId]: {
          captureUrls,
          videoUrl,
          loadedAt: Date.now()
        }
      }));
    } catch (error) {
      console.error('[HistoryComponent] Falha ao atualizar URLs assinadas.', error);
      this.loadError.set('Não foi possível atualizar as URLs. Verifique as permissões do S3 ou tente novamente.');
    } finally {
      this.loadingMedia.set(false);
    }
  }
}


