import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface GetLogsRequest {
  startTime?: string;
  endTime?: string;
  filterPattern?: string;
  limit?: number;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  logStreamName?: string;
}

export interface LogsResponse {
  logs: LogEntry[];
  totalCount: number;
  nextToken?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class LogsService {
  private readonly API_URL = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getLogs(request: GetLogsRequest): Observable<LogsResponse> {
    return this.http.post<LogsResponse>(`${this.API_URL}/logs/search`, request);
  }

  getRecentLogs(filter?: string, limit: number = 100): Observable<LogsResponse> {
    const params: any = { limit };
    if (filter) {
      params.filter = filter;
    }
    return this.http.get<LogsResponse>(`${this.API_URL}/logs/recent`, { params });
  }
}

