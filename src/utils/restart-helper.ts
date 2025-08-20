import * as vscode from 'vscode';

/**
 * VS Code 重启工具模块
 * 提供重启功能和相关的用户交互
 */

/**
 * 重启 VS Code
 * @returns Promise<boolean> 是否成功执行重启命令
 */
export async function restartVSCode(): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
    return true;
  } catch (error) {
    console.error('重启 VS Code 失败:', error);
    vscode.window.showErrorMessage('重启失败，请手动重启 VS Code');
    return false;
  }
}

/**
 * 显示管理员重启指导
 * 为用户提供以管理员身份重启 VS Code 的详细指导
 */
export async function showAdminRestartGuidance(): Promise<void> {
  const platform = process.platform;
  let guidance = '';
  
  switch (platform) {
    case 'win32':
      guidance = `请按以下步骤以管理员身份重启 VS Code：

1. 关闭当前 VS Code 窗口
2. 右键点击 VS Code 图标
3. 选择"以管理员身份运行"
4. 重新打开您的项目

这样可以获得修改系统文件的权限。`;
      break;
    case 'darwin':
      guidance = `请按以下步骤以管理员身份重启 VS Code：

1. 关闭当前 VS Code 窗口
2. 打开终端应用
3. 运行命令: sudo code
4. 输入管理员密码
5. 重新打开您的项目

这样可以获得修改系统文件的权限。`;
      break;
    default:
      guidance = `请按以下步骤以 root 权限重启 VS Code：

1. 关闭当前 VS Code 窗口
2. 打开终端
3. 运行命令: sudo code
4. 输入管理员密码
5. 重新打开您的项目

这样可以获得修改系统文件的权限。`;
      break;
  }

  await vscode.window.showInformationMessage(
    guidance,
    { modal: true },
    '我知道了'
  );
}

/**
 * 显示重启提示对话框
 * @param message 提示消息
 * @param showAdminGuidance 是否显示管理员指导
 * @returns Promise<boolean> 用户是否选择重启
 */
export async function showRestartPrompt(
  message: string,
  showAdminGuidance: boolean = false
): Promise<boolean> {
  const buttons = showAdminGuidance 
    ? ['立即重启', '查看管理员指导', '稍后重启']
    : ['立即重启', '稍后重启'];

  const selection = await vscode.window.showInformationMessage(
    message,
    { modal: false },
    ...buttons
  );

  switch (selection) {
    case '立即重启':
      if (showAdminGuidance) {
        // 先显示管理员指导，然后重启
        await showAdminRestartGuidance();
      }
      return await restartVSCode();
    
    case '查看管理员指导':
      await showAdminRestartGuidance();
      // 显示指导后，再次询问是否重启
      return await showRestartPrompt(
        '查看完指导后，您现在要重启 VS Code 吗？',
        false
      );
    
    case '稍后重启':
    default:
      return false;
  }
}

/**
 * 显示权限错误的重启提示
 * 专门用于处理权限错误场景
 */
export async function showPermissionErrorRestartPrompt(): Promise<void> {
  const message = `❌ 修改 product.json 需要管理员权限

请以管理员/root 权限重启 VS Code 后重试。
重启后扩展会自动重新尝试修改。`;

  await showRestartPrompt(message, true);
}

/**
 * 显示 patch 成功后的重启提示
 * @param productPath product.json 文件路径
 */
export async function showPatchSuccessRestartPrompt(productPath?: string): Promise<void> {
  const pathInfo = productPath ? `\n路径: ${productPath}` : '';
  const message = `✅ product.json 修改成功！${pathInfo}

⚠️ 需要重启 VS Code 才能使 API 提案生效。
建议现在重启以确保扩展正常工作。`;

  await showRestartPrompt(message, false);
}
