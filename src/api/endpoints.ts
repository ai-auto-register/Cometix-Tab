export enum EndpointType {
  OFFICIAL = 'official',    // api2.cursor.sh Connect RPC 格式
  SELF_HOSTED = 'selfhosted' // cursor-api REST 接口格式
}

export interface EndpointConfig {
  baseUrl: string;
  type: EndpointType;
}

export const ENDPOINT_MAPPINGS = {
  [EndpointType.OFFICIAL]: {
    streamCpp: '/aiserver.v1.AiService/StreamCpp',
    cppConfig: '/aiserver.v1.AiService/CppConfig', 
    availableModels: '/aiserver.v1.CppService/AvailableModels',
    uploadFile: '/filesync.v1.FileSyncService/FSUploadFile',
    syncFile: '/filesync.v1.FileSyncService/FSSyncFile'
  },
  [EndpointType.SELF_HOSTED]: {
    streamCpp: '/cpp/stream',
    cppConfig: '/cpp/config',
    availableModels: '/cpp/models',
    uploadFile: '/file/upload', 
    syncFile: '/file/sync'
  }
} as const;

export const DEFAULT_ENDPOINTS: Record<EndpointType, string> = {
  [EndpointType.OFFICIAL]: 'https://api2.cursor.sh',
  [EndpointType.SELF_HOSTED]: 'http://localhost:8000' // 默认自部署地址
};

export function getEndpointUrl(
  endpointType: EndpointType,
  baseUrl: string,
  endpoint: keyof typeof ENDPOINT_MAPPINGS[EndpointType.OFFICIAL]
): string {
  const path = ENDPOINT_MAPPINGS[endpointType][endpoint];
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}