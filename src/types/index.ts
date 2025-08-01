// 基础类型定义
export interface CursorConfig {
  enabled: boolean;
  serverUrl: string;
  authToken: string;
  clientKey: string;
  gcppHost: 'US' | 'EU' | 'Asia';
  model: 'auto' | 'fast' | 'advanced';
  snoozeUntil: number;
  maxCompletionLength: number;
  debounceMs: number;
}

export interface FileInfo {
  path: string;
  content: string;
  sha256: string;
  modelVersion?: number;
}

export interface CompletionRequest {
  currentFile: FileInfo;
  cursorPosition: {
    line: number;
    column: number;
  };
  context?: string;
  additionalFiles?: FileInfo[];
  diffHistory?: string[];
  modelName?: string;
  debugOutput?: boolean;
}

export interface CompletionResponse {
  text: string;
  range?: {
    startLine: number;
    endLine: number;
  };
  cursorPosition?: {
    line: number;
    column: number;
  };
}

export type SSEEventType = 
  | 'text'
  | 'model_info'
  | 'range_replace'
  | 'cursor_prediction'
  | 'done_edit'
  | 'done_stream'
  | 'debug'
  | 'error'
  | 'cancel'
  | 'heartbeat'
  | 'protobuf_message'
  | 'unknown';

// Protobuf消息相关类型
export interface CursorPosition {
  line: number;
  column: number;
}

export interface CurrentFileInfo {
  relative_workspace_path: string;
  contents: string;
  cursor_position: CursorPosition;
  sha256_hash: string;
}

export interface StreamCppRequestData {
  current_file: CurrentFileInfo;
  diff_history?: string[];
  model_name?: string;
  give_debug_output?: boolean;
}

export interface StreamCppResponseData {
  text?: string;
  suggestion_start_line?: number;
  suggestion_confidence?: number;
  done_stream?: boolean;
  debug_model_output?: string;
}

// 文件同步相关类型
export interface FSUploadFileRequestData {
  uuid: string;
  relative_workspace_path: string;
  contents: string;
  model_version: number;
  sha256_hash?: string;
}

export interface FSUploadFileResponseData {
  error: number;
}

export interface FSSyncFileRequestData {
  uuid: string;
  relative_workspace_path: string;
  model_version: number;
  filesync_updates: any[];
  sha256_hash: string;
}

export interface FSSyncFileResponseData {
  error: number;
}