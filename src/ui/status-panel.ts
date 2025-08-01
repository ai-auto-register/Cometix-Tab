import * as vscode from 'vscode';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';

export class StatusPanel {
  private static currentPanel: StatusPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly logger: Logger;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.logger = Logger.getInstance();

    this.update();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'toggleEnabled':
            await this.toggleEnabled();
            break;
          case 'selectModel':
            await ConfigManager.updateConfig('model', message.value);
            this.update();
            vscode.window.showInformationMessage(`已切换到 ${message.value} 模型`);
            break;
          case 'snooze':
            await this.handleSnooze(message.minutes);
            break;
          case 'openSettings':
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:cometix-tab');
            this.panel.dispose();
            break;
          case 'showLogs':
            this.logger.show();
            this.panel.dispose();
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.One;

    if (StatusPanel.currentPanel) {
      StatusPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'cometixTabStatus',
      'Cometix Tab',
      column,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media')
        ],
        retainContextWhenHidden: true
      }
    );

    StatusPanel.currentPanel = new StatusPanel(panel, extensionUri);
  }

  private async toggleEnabled() {
    const config = ConfigManager.getConfig();
    await ConfigManager.updateConfig('enabled', !config.enabled);
    this.update();
  }

  private async handleSnooze(minutes: number) {
    if (minutes === 0) {
      // 取消snooze
      await ConfigManager.updateConfig('snoozeUntil', 0);
      vscode.window.showInformationMessage('已恢复AI代码补全');
    } else {
      // 设置snooze
      const snoozeUntil = Date.now() + (minutes * 60 * 1000);
      await ConfigManager.updateConfig('snoozeUntil', snoozeUntil);
      vscode.window.showInformationMessage(`AI补全已暂停 ${minutes}分钟`);
    }
    this.update();
  }

  private update() {
    const config = ConfigManager.getConfig();
    const isSnoozing = config.snoozeUntil > Date.now();
    
    this.panel.title = 'Cometix Tab';
    this.panel.webview.html = this.getHtmlForWebview(config, isSnoozing);
  }

  private getHtmlForWebview(config: any, isSnoozing: boolean): string {
    const webview = this.panel.webview;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cometix Tab</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 16px;
            min-width: 280px;
            max-width: 320px;
        }
        
        .header {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--vscode-foreground);
        }
        
        .option {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-widget-border);
            cursor: pointer;
            min-height: 32px;
        }
        
        .option:hover {
            background-color: var(--vscode-list-hoverBackground);
            margin: 0 -8px;
            padding: 8px;
            border-radius: 4px;
        }
        
        .option:last-child {
            border-bottom: none;
        }
        
        .option-label {
            font-size: 13px;
            flex: 1;
        }
        
        .option-value {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-left: 8px;
        }
        
        .toggle {
            width: 40px;
            height: 20px;
            background-color: ${config.enabled && !isSnoozing ? 'var(--vscode-button-background)' : 'var(--vscode-input-background)'};
            border-radius: 10px;
            position: relative;
            cursor: pointer;
            transition: background-color 0.2s;
            border: 1px solid var(--vscode-widget-border);
        }
        
        .toggle::after {
            content: '';
            position: absolute;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background-color: var(--vscode-foreground);
            top: 1px;
            left: ${config.enabled && !isSnoozing ? '21px' : '1px'};
            transition: left 0.2s;
        }
        
        .separator {
            height: 1px;
            background-color: var(--vscode-widget-border);
            margin: 12px 0;
        }
        
        .model-dropdown {
            position: relative;
        }
        
        .model-select {
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            color: var(--vscode-dropdown-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            min-width: 100px;
        }
        
        .snooze-time {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        
        .disabled {
            opacity: 0.6;
        }
        
        .status {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
    </style>
</head>
<body>
    <div class="header">代码完成</div>
    
    <div class="option" onclick="toggleEnabled()">
        <div class="option-label">${config.enabled && !isSnoozing ? '全局禁用' : '全局启用'}</div>
        <div class="toggle"></div>
    </div>
    
    <div class="option">
        <div class="option-label">模型</div>
        <select class="model-select" onchange="selectModel(this.value)">
            <option value="auto" ${config.model === 'auto' ? 'selected' : ''}>auto (默认)</option>
            <option value="fast" ${config.model === 'fast' ? 'selected' : ''}>fast</option>
            <option value="advanced" ${config.model === 'advanced' ? 'selected' : ''}>advanced</option>
        </select>
    </div>
    
    <div class="option" onclick="toggleSnooze()">
        <div class="option-label">
            Snooze
            ${isSnoozing ? `<div class="status">暂停至 ${new Date(config.snoozeUntil).toLocaleTimeString()}</div>` : ''}
        </div>
        <div class="option-value">${isSnoozing ? '取消' : ''}</div>
    </div>
    
    <div class="separator"></div>
    
    <div class="option" onclick="openSettings()">
        <div class="option-label">配置设置</div>
    </div>
    
    <div class="option" onclick="showLogs()">
        <div class="option-label">查看日志</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function toggleEnabled() {
            vscode.postMessage({ type: 'toggleEnabled' });
        }
        
        function selectModel(value) {
            vscode.postMessage({ type: 'selectModel', value: value });
        }
        
        function toggleSnooze() {
            const isSnoozing = ${isSnoozing};
            if (isSnoozing) {
                vscode.postMessage({ type: 'snooze', minutes: 0 });
            } else {
                // 显示时长选择
                const minutes = prompt('请输入暂停分钟数 (5, 15, 30, 60):', '15');
                if (minutes && !isNaN(minutes)) {
                    vscode.postMessage({ type: 'snooze', minutes: parseInt(minutes) });
                }
            }
        }
        
        function openSettings() {
            vscode.postMessage({ type: 'openSettings' });
        }
        
        function showLogs() {
            vscode.postMessage({ type: 'showLogs' });
        }
    </script>
</body>
</html>`;
  }

  public dispose() {
    StatusPanel.currentPanel = undefined;
    this.panel.dispose();
    
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}