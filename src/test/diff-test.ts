/**
 * 简单的diff功能测试
 * 用于验证SmartCompletionDiffer的基础功能
 */

import * as vscode from 'vscode';
import { SmartCompletionDiffer } from '../utils/smart-completion-differ';
import { CompletionContext, DiffMethod } from '../types/completion-diff';

/**
 * 测试用例接口
 */
interface TestCase {
  name: string;
  context: CompletionContext;
  apiResponse: string;
  expectedInsertion: string;
  minConfidence: number;
}

/**
 * 运行diff测试
 */
export function runDiffTests(): void {
  const differ = SmartCompletionDiffer.getInstance();
  
  const testCases: TestCase[] = [
    {
      name: "部分单词补全",
      context: {
        beforeCursor: "const use",
        afterCursor: "",
        currentLine: "const use",
        position: new vscode.Position(0, 9),
        language: "typescript",
        indentation: ""
      },
      apiResponse: "const user = 'John';",
      expectedInsertion: "r = 'John';",
      minConfidence: 0.7
    },
    
    {
      name: "多行补全",
      context: {
        beforeCursor: "if (condition",
        afterCursor: "",
        currentLine: "if (condition",
        position: new vscode.Position(0, 13),
        language: "typescript",
        indentation: ""
      },
      apiResponse: "if (condition) {\n    doWork();\n}",
      expectedInsertion: ") {\n    doWork();\n}",
      minConfidence: 0.6
    },
    
    {
      name: "函数参数补全",
      context: {
        beforeCursor: "function test(",
        afterCursor: ") {}",
        currentLine: "function test() {}",
        position: new vscode.Position(0, 14),
        language: "typescript",
        indentation: ""
      },
      apiResponse: "function test(param1: string, param2: number) {}",
      expectedInsertion: "param1: string, param2: number",
      minConfidence: 0.5
    },
    
    {
      name: "表达式补全",
      context: {
        beforeCursor: "console.",
        afterCursor: "",
        currentLine: "console.",
        position: new vscode.Position(0, 8),
        language: "typescript",
        indentation: ""
      },
      apiResponse: "console.log('Hello World');",
      expectedInsertion: "log('Hello World');",
      minConfidence: 0.7
    }
  ];
  
  console.log('🧪 开始diff算法测试...\n');
  
  let passedTests = 0;
  let totalTests = testCases.length;
  
  for (const testCase of testCases) {
    console.log(`📝 测试: ${testCase.name}`);
    console.log(`   输入: "${testCase.context.beforeCursor}" + "${testCase.apiResponse}"`);
    
    try {
      const result = differ.extractCompletionDiff(testCase.context, testCase.apiResponse);
      
      console.log(`   结果: "${result.insertText}"`);
      console.log(`   方法: ${result.method}`);
      console.log(`   置信度: ${result.confidence.toFixed(3)}`);
      console.log(`   处理时间: ${result.processingTimeMs.toFixed(2)}ms`);
      
      // 验证结果
      const isSuccess = result.confidence >= testCase.minConfidence;
      
      if (isSuccess) {
        console.log(`   ✅ 通过 (置信度 ${result.confidence.toFixed(3)} >= ${testCase.minConfidence})`);
        passedTests++;
      } else {
        console.log(`   ❌ 失败 (置信度 ${result.confidence.toFixed(3)} < ${testCase.minConfidence})`);
      }
      
      if (result.optimizations.length > 0) {
        console.log(`   🔧 优化: ${result.optimizations.join(', ')}`);
      }
      
    } catch (error) {
      console.log(`   ❌ 异常: ${(error as Error).message}`);
    }
    
    console.log('');
  }
  
  console.log(`📊 测试结果: ${passedTests}/${totalTests} 通过 (${(passedTests/totalTests*100).toFixed(1)}%)`);
  
  if (passedTests === totalTests) {
    console.log('🎉 所有测试通过！');
  } else {
    console.log('⚠️ 部分测试失败，需要进一步优化');
  }
}

/**
 * 运行性能测试
 */
export function runPerformanceTests(): void {
  const differ = SmartCompletionDiffer.getInstance();
  
  console.log('⚡ 开始性能测试...\n');
  
  // 测试不同长度的文本
  const testSizes = [10, 100, 500, 1000, 2000];
  
  for (const size of testSizes) {
    const beforeText = 'const '.repeat(size);
    const apiResponse = beforeText + 'user = "test";';
    
    const context: CompletionContext = {
      beforeCursor: beforeText,
      afterCursor: "",
      currentLine: beforeText,
      position: new vscode.Position(0, beforeText.length),
      language: "typescript",
      indentation: ""
    };
    
    const startTime = performance.now();
    const result = differ.extractCompletionDiff(context, apiResponse);
    const endTime = performance.now();
    
    console.log(`📏 文本长度: ${size * 6} 字符`);
    console.log(`   处理时间: ${(endTime - startTime).toFixed(2)}ms`);
    console.log(`   方法: ${result.method}`);
    console.log(`   置信度: ${result.confidence.toFixed(3)}`);
    console.log('');
  }
  
  // 清理缓存统计
  const cacheStats = differ.getCacheStats();
  console.log(`📊 缓存统计: 大小=${cacheStats.size}, 命中率=${cacheStats.hitRate}`);
  
  differ.clearCache();
  console.log('🧹 缓存已清理');
}

/**
 * 运行所有测试
 */
export function runAllTests(): void {
  console.log('🚀 开始智能diff算法测试套件\n');
  console.log('='.repeat(50));
  
  runDiffTests();
  
  console.log('='.repeat(50));
  
  runPerformanceTests();
  
  console.log('='.repeat(50));
  console.log('🏁 测试完成！');
}

// 如果直接运行此文件，执行所有测试
if (require.main === module) {
  runAllTests();
}