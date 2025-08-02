import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

/**
 * 测试file_diff_histories功能
 */
export async function testFileDiffHistories(): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('请先打开一个文件');
      return;
    }

    logger.info('🧪 开始测试 file_diff_histories 功能...');
    logger.info(`📄 当前文件: ${editor.document.fileName}`);
    logger.info(`📍 光标位置: ${editor.selection.active.line}:${editor.selection.active.character}`);

    // 执行一系列编辑操作来测试diff历史跟踪
    const position = editor.selection.active;
    
    // 第一次编辑：插入注释
    logger.info('🔧 执行第一次编辑：插入测试注释...');
    const edit1 = new vscode.WorkspaceEdit();
    edit1.insert(editor.document.uri, position, '\n// 测试 file_diff_histories 第一次编辑');
    await vscode.workspace.applyEdit(edit1);
    
    // 等待EditHistoryTracker处理
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // 第二次编辑：添加空行
    logger.info('🔧 执行第二次编辑：添加空行...');
    const newPosition = new vscode.Position(position.line + 1, 0);
    const edit2 = new vscode.WorkspaceEdit();
    edit2.insert(editor.document.uri, newPosition, '\n');
    await vscode.workspace.applyEdit(edit2);
    
    // 等待EditHistoryTracker处理
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // 第三次编辑：添加另一行注释
    logger.info('🔧 执行第三次编辑：添加第二行注释...');
    const finalPosition = new vscode.Position(position.line + 2, 0);
    const edit3 = new vscode.WorkspaceEdit();
    edit3.insert(editor.document.uri, finalPosition, '// 测试 file_diff_histories 第二次编辑\n');
    await vscode.workspace.applyEdit(edit3);
    
    // 最后等待处理
    await new Promise(resolve => setTimeout(resolve, 500));
    
    logger.info('✅ 所有编辑操作已完成！');
    logger.info('📊 EditHistoryTracker 应该已经记录了这些编辑历史');
    logger.info('🔍 下次触发补全时，这些编辑历史将作为 file_diff_histories 发送给API');
    
    vscode.window.showInformationMessage('✅ file_diff_histories 测试完成！现在可以试着触发代码补全来查看 file_diff_histories 是否正常工作');
    
  } catch (error) {
    logger.error('❌ file_diff_histories 测试失败', error as Error);
    vscode.window.showErrorMessage('file_diff_histories 测试失败');
  }
}