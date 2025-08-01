import { Logger } from './logger';
import { ProtobufUtils } from './protobuf';
import type { SSEEventType } from '../types';

export interface SSEMessage {
  type: SSEEventType;
  data: any;
  raw?: string;
}

/**
 * Connect RPC SSE流式响应解析器
 * 
 * Connect RPC使用特殊的SSE格式，与传统SSE不同：
 * - 5字节头部：1字节消息类型 + 4字节长度（小端序）
 * - 消息体：protobuf或JSON格式
 * - 支持gzip压缩
 * - 兼容cursor-api的流式响应格式
 */
export class SSEParser {
  private logger: Logger;
  private protobufUtils: ProtobufUtils;
  private decoder = new TextDecoder();
  
  // 消息类型映射（基于cursor-api实现）
  private static readonly MESSAGE_TYPES = {
    0x00: 'text',
    0x01: 'model_info', 
    0x02: 'range_replace',
    0x03: 'cursor_prediction',
    0x04: 'done_edit',
    0x05: 'done_stream',
    0x06: 'debug',
    0x07: 'error',
    0x08: 'cancel',
    0x09: 'heartbeat',
    0x0A: 'protobuf_message'
  } as const;

  constructor() {
    this.logger = Logger.getInstance();
    this.protobufUtils = ProtobufUtils.getInstance();
  }

  /**
   * 解析SSE流数据
   */
  async *parseSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage, void, unknown> {
    const reader = stream.getReader();
    let buffer = new Uint8Array(0);

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        // 合并缓冲区数据
        buffer = this.concatenateUint8Arrays(buffer, value);

        // 解析所有完整的消息
        const result = this.parseMessages(buffer);
        buffer = result.remaining;

        // 生成解析出的消息
        for (const message of result.messages) {
          yield message;
          
          // 如果是流结束消息，停止解析
          if (message.type === 'done_stream') {
            return;
          }
        }
      }
    } catch (error) {
      this.logger.error('Error parsing SSE stream', error as Error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 从缓冲区解析消息
   */
  private parseMessages(buffer: Uint8Array): { messages: SSEMessage[], remaining: Uint8Array } {
    const messages: SSEMessage[] = [];
    let offset = 0;

    while (offset + 5 <= buffer.length) {
      // 读取5字节头部
      const messageType = buffer[offset];
      const length = this.readUint32LE(buffer, offset + 1);

      // 检查是否有完整的消息体
      if (offset + 5 + length > buffer.length) {
        break; // 数据不完整，等待更多数据
      }

      // 提取消息体
      const messageBody = buffer.slice(offset + 5, offset + 5 + length);
      
      // 解析消息
      try {
        const message = this.parseMessage(messageType, messageBody);
        messages.push(message);
      } catch (error) {
        this.logger.warn(`Failed to parse message type ${messageType}`, error as Error);
      }

      offset += 5 + length;
    }

    // 返回剩余未处理的数据
    const remaining = buffer.slice(offset);
    return { messages, remaining };
  }

  /**
   * 解析单个消息
   */
  private parseMessage(messageType: number, messageBody: Uint8Array): SSEMessage {
    const typeName = SSEParser.MESSAGE_TYPES[messageType as keyof typeof SSEParser.MESSAGE_TYPES] || 'unknown';
    
    try {
      let data: any = null;

      switch (typeName) {
        case 'text':
          // 文本消息，直接解码
          data = this.decoder.decode(messageBody);
          break;

        case 'model_info':
        case 'range_replace':
        case 'cursor_prediction':
          // JSON格式的消息
          try {
            const jsonStr = this.decoder.decode(messageBody);
            data = JSON.parse(jsonStr);
          } catch {
            data = this.decoder.decode(messageBody);
          }
          break;

        case 'done_edit':
        case 'done_stream':
        case 'cancel':
        case 'heartbeat':
          // 控制消息，通常没有数据或数据很简单
          data = messageBody.length > 0 ? this.decoder.decode(messageBody) : null;
          break;

        case 'debug':
        case 'error':
          // 调试和错误消息
          data = this.decoder.decode(messageBody);
          break;

        case 'protobuf_message':
          // Protobuf消息，需要进一步解析
          try {
            data = this.protobufUtils.parseStreamCppResponse(messageBody);
          } catch (error) {
            this.logger.warn('Failed to parse protobuf message', error as Error);
            data = messageBody;
          }
          break;

        default:
          // 未知消息类型，保留原始数据
          data = messageBody;
          this.logger.warn(`Unknown message type: ${messageType} (${typeName})`);
          break;
      }

      return {
        type: typeName as SSEEventType,
        data,
        raw: messageBody.length < 1000 ? this.decoder.decode(messageBody) : undefined
      };

    } catch (error) {
      this.logger.error(`Failed to parse message type ${typeName}`, error as Error);
      
      return {
        type: 'error' as SSEEventType,
        data: `Parse error: ${error}`,
        raw: this.decoder.decode(messageBody)
      };
    }
  }

  /**
   * 读取小端序的32位无符号整数
   */
  private readUint32LE(buffer: Uint8Array, offset: number): number {
    return (
      buffer[offset] |
      (buffer[offset + 1] << 8) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 24)
    ) >>> 0; // 无符号右移确保结果为正数
  }

  /**
   * 连接多个Uint8Array
   */
  private concatenateUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  /**
   * 检查数据是否可能是gzip压缩的
   */
  private isGzipCompressed(buffer: Uint8Array): boolean {
    return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  }

  /**
   * 解压gzip数据（如果需要的话）
   */
  private async decompressGzip(buffer: Uint8Array): Promise<Uint8Array> {
    if (!this.isGzipCompressed(buffer)) {
      return buffer;
    }

    try {
      // 使用CompressionStream API进行解压
      const stream = new CompressionStream('gzip');
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();

      writer.write(buffer);
      writer.close();

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
      }

      return this.concatenateUint8Arrays(...chunks);
    } catch (error) {
      this.logger.warn('Failed to decompress gzip data', error as Error);
      return buffer;
    }
  }
}

/**
 * 传统的SSE事件解析器（用于文本格式的SSE）
 */
export class TextSSEParser {
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * 解析传统的文本SSE格式
   */
  parseTextSSE(buffer: string): { events: SSEMessage[], remaining: string } {
    const events: SSEMessage[] = [];
    const lines = buffer.split('\n');
    let remaining = '';
    let currentEvent: Partial<SSEMessage> = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line === '') {
        // 空行表示事件结束
        if (currentEvent.type) {
          events.push(currentEvent as SSEMessage);
        }
        currentEvent = {};
      } else if (line.startsWith('event: ')) {
        currentEvent.type = line.substring(7).trim() as SSEEventType;
      } else if (line.startsWith('data: ')) {
        const data = line.substring(6);
        try {
          currentEvent.data = JSON.parse(data);
        } catch {
          currentEvent.data = data;
        }
      } else if (i === lines.length - 1 && !line.includes('\n')) {
        // 最后一行可能不完整
        remaining = line;
      }
    }

    return { events, remaining };
  }
}