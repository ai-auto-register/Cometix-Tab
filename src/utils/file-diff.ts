import { SingleUpdateRequest, FilesyncUpdateWithModelVersion } from '../generated/cpp_pb';
import { Logger } from './logger';

/**
 * 文件差异计算工具
 * 实现增量同步所需的差异检测和更新生成
 */
export class FileDiffCalculator {
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * 计算两个文件内容之间的差异
   * 返回可用于增量同步的更新列表
   */
  calculateDiff(oldContent: string, newContent: string): SingleUpdateRequest[] {
    // 优先使用LCS算法，对复杂差异有更好的处理
    if (Math.abs(oldContent.length - newContent.length) > 100 || 
        oldContent.split('\n').length !== newContent.split('\n').length) {
      this.logger.debug('🔧 使用LCS算法处理复杂差异');
      return this.calculateOptimizedDiff(oldContent, newContent);
    }
    
    const updates: SingleUpdateRequest[] = [];
    
    // 简单的逐字符差异检测算法
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    let oldPos = 0;
    let newPos = 0;
    let oldCharPos = 0;
    
    // 逐行比较
    while (oldPos < oldLines.length || newPos < newLines.length) {
      if (oldPos >= oldLines.length) {
        // 旧文件已结束，新文件还有内容 - 插入
        const remainingLines = newLines.slice(newPos);
        if (remainingLines.length > 0) {
          const remainingContent = remainingLines.join('\n');
          updates.push(new SingleUpdateRequest({
            startPosition: oldCharPos,
            endPosition: oldCharPos,
            changeLength: remainingContent.length,
            replacedString: remainingContent
          }));
        }
        break;
      } else if (newPos >= newLines.length) {
        // 新文件已结束，旧文件还有内容 - 删除
        const remainingLines = oldLines.slice(oldPos);
        const remainingContent = remainingLines.join('\n');
        updates.push(new SingleUpdateRequest({
          startPosition: oldCharPos,
          endPosition: oldCharPos + remainingContent.length,
          changeLength: 0,
          replacedString: ''
        }));
        break;
      } else if (oldLines[oldPos] === newLines[newPos]) {
        // 行相同，跳过
        const lineLength = oldLines[oldPos].length;
        // 正确处理换行符：除了最后一行，其他行都有换行符
        const hasNewline = oldPos < oldLines.length - 1;
        oldCharPos += lineLength + (hasNewline ? 1 : 0);
        oldPos++;
        newPos++;
      } else {
        // 行不同，需要替换
        const oldLine = oldLines[oldPos];
        const newLine = newLines[newPos];
        
        const lineStartPos = oldCharPos;
        const lineEndPos = oldCharPos + oldLine.length;
        
        updates.push(new SingleUpdateRequest({
          startPosition: lineStartPos,
          endPosition: lineEndPos,
          changeLength: newLine.length,
          replacedString: newLine
        }));
        
        // 正确处理换行符：除了最后一行，其他行都有换行符
        const oldHasNewline = oldPos < oldLines.length - 1;
        oldCharPos += oldLine.length + (oldHasNewline ? 1 : 0);
        oldPos++;
        newPos++;
      }
    }
    
    this.logger.debug(`📊 差异计算完成: 发现 ${updates.length} 个更新`);
    updates.forEach((update, index) => {
      this.logger.debug(`  更新 ${index + 1}: 位置 ${update.startPosition}-${update.endPosition}, 长度 ${update.changeLength}, 内容: "${update.replacedString.substring(0, 50)}${update.replacedString.length > 50 ? '...' : ''}"`);
    });
    
    return updates;
  }

  /**
   * 构建增量同步更新消息
   */
  buildFilesyncUpdate(
    filePath: string,
    oldContent: string,
    newContent: string,
    modelVersion: number
  ): FilesyncUpdateWithModelVersion {
    const updates = this.calculateDiff(oldContent, newContent);
    
    return new FilesyncUpdateWithModelVersion({
      modelVersion,
      relativeWorkspacePath: filePath,
      updates,
      expectedFileLength: newContent.length
    });
  }

  /**
   * 优化的差异算法（使用 Myers 算法的简化版本）
   * 更高效地处理大文件
   */
  calculateOptimizedDiff(oldContent: string, newContent: string): SingleUpdateRequest[] {
    // 对于复杂差异，使用字符级别的差异算法
    const updates: SingleUpdateRequest[] = [];
    
    // 简单实现：找到第一个和最后一个不同的位置
    let startDiff = 0;
    let endDiff = 0;
    
    // 从前往后找第一个不同的字符
    while (startDiff < oldContent.length && 
           startDiff < newContent.length && 
           oldContent[startDiff] === newContent[startDiff]) {
      startDiff++;
    }
    
    // 从后往前找第一个不同的字符
    while (endDiff < oldContent.length - startDiff && 
           endDiff < newContent.length - startDiff && 
           oldContent[oldContent.length - 1 - endDiff] === newContent[newContent.length - 1 - endDiff]) {
      endDiff++;
    }
    
    // 如果有差异，创建一个更新
    if (startDiff < oldContent.length || startDiff < newContent.length) {
      const oldEndPos = oldContent.length - endDiff;
      const newEndPos = newContent.length - endDiff;
      
      const replacedString = newContent.substring(startDiff, newEndPos);
      
      updates.push(new SingleUpdateRequest({
        startPosition: startDiff,
        endPosition: oldEndPos,
        changeLength: replacedString.length,
        replacedString: replacedString
      }));
      
      this.logger.debug(`🔧 LCS差异: 位置 ${startDiff}-${oldEndPos}, 新长度 ${replacedString.length}`);
    }
    
    return updates;
  }

  /**
   * 计算最长公共子序列
   */
  private longestCommonSubsequence(oldLines: string[], newLines: string[]): number[][] {
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    
    return dp;
  }

  /**
   * 基于LCS构建更新列表
   */
  private buildUpdatesFromLCS(
    oldLines: string[],
    newLines: string[],
    lcs: number[][]
  ): SingleUpdateRequest[] {
    const updates: SingleUpdateRequest[] = [];
    let i = oldLines.length;
    let j = newLines.length;
    let oldCharPos = oldLines.join('\n').length;
    let newCharPos = newLines.join('\n').length;
    
    // 从后往前回溯
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        // 相同行，跳过
        const lineLength = oldLines[i - 1].length;
        oldCharPos -= lineLength + (i > 1 ? 1 : 0); // -1 for newline
        newCharPos -= lineLength + (j > 1 ? 1 : 0);
        i--;
        j--;
      } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
        // 插入新行
        const newLine = newLines[j - 1];
        newCharPos -= newLine.length + (j > 1 ? 1 : 0);
        
        updates.unshift(new SingleUpdateRequest({
          startPosition: oldCharPos,
          endPosition: oldCharPos,
          changeLength: newLine.length + (j > 1 ? 1 : 0),
          replacedString: newLine + (j > 1 ? '\n' : '')
        }));
        
        j--;
      } else if (i > 0) {
        // 删除旧行
        const oldLine = oldLines[i - 1];
        oldCharPos -= oldLine.length + (i > 1 ? 1 : 0);
        
        updates.unshift(new SingleUpdateRequest({
          startPosition: oldCharPos,
          endPosition: oldCharPos + oldLine.length + (i > 1 ? 1 : 0),
          changeLength: 0,
          replacedString: ''
        }));
        
        i--;
      }
    }
    
    return updates;
  }

  /**
   * 验证更新序列的正确性
   * 应用所有更新后应该得到新内容
   */
  validateUpdates(oldContent: string, newContent: string, updates: SingleUpdateRequest[]): boolean {
    let result = oldContent;
    
    // 从后往前应用更新，避免位置偏移问题
    const sortedUpdates = [...updates].sort((a, b) => b.startPosition - a.startPosition);
    
    for (const update of sortedUpdates) {
      const before = result.substring(0, update.startPosition);
      const after = result.substring(update.endPosition);
      result = before + update.replacedString + after;
    }
    
    const isValid = result === newContent;
    if (!isValid) {
      this.logger.error('❌ 差异验证失败');
      this.logger.debug(`期望长度: ${newContent.length}, 实际长度: ${result.length}`);
      this.logger.debug(`期望内容: "${newContent.substring(0, 100)}..."`);
      this.logger.debug(`实际内容: "${result.substring(0, 100)}..."`);
    } else {
      this.logger.debug('✅ 差异验证通过');
    }
    
    return isValid;
  }
}