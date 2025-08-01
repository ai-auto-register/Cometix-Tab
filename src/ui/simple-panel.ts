import * as vscode from 'vscode';
import { ConfigManager } from '../utils/config';

export class SimplePanel {
  public static async show() {
    const config = ConfigManager.getConfig();
    const isSnoozing = config.snoozeUntil > Date.now();

    // 创建模拟Cursor的悬浮面板菜单
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = '代码完成';
    quickPick.canSelectMany = false;
    quickPick.matchOnDetail = false;
    quickPick.matchOnDescription = false;

    const items: vscode.QuickPickItem[] = [
      {
        label: `$(toggle-${config.enabled && !isSnoozing ? 'on' : 'off'}) ${config.enabled && !isSnoozing ? '全局禁用' : '全局启用'}`,
        description: 'toggle'
      },
      {
        label: `$(chevron-right) 模型`,
        detail: `${config.model} (默认)`,
        description: 'model'
      },
      {
        label: isSnoozing ? `$(bell) Snooze $(clock) ${new Date(config.snoozeUntil).toLocaleTimeString()}` : '$(bell-slash) Snooze',
        description: 'snooze'
      }
    ];

    quickPick.items = items;
    
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (selected?.description) {
        quickPick.hide();
        await SimplePanel.handleAction(selected.description, config, isSnoozing);
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  }

  private static async handleAction(action: string, config: any, isSnoozing: boolean) {
    switch (action) {
      case 'toggle':
        await ConfigManager.updateConfig('enabled', !config.enabled);
        const newState = !config.enabled;
        vscode.window.showInformationMessage(
          `AI补全已${newState ? '启用' : '禁用'}`
        );
        break;

      case 'model':
        await SimplePanel.showModelPicker();
        break;

      case 'snooze':
        if (isSnoozing) {
          await ConfigManager.updateConfig('snoozeUntil', 0);
          vscode.window.showInformationMessage('已取消Snooze');
        } else {
          await SimplePanel.showSnoozePicker();
        }
        break;
    }
  }

  private static async showModelPicker() {
    const config = ConfigManager.getConfig();
    
    const models = [
      {
        label: '$(auto-fix) auto (默认)',
        detail: '自动选择最适合的模型',
        picked: config.model === 'auto'
      },
      {
        label: '$(zap) fast',
        detail: '快速响应，适合简单补全',
        picked: config.model === 'fast'
      },
      {
        label: '$(rocket) advanced', 
        detail: '高级模型，适合复杂代码生成',
        picked: config.model === 'advanced'
      }
    ];

    const selected = await vscode.window.showQuickPick(models, {
      title: '模型',
      placeHolder: '选择AI补全模型'
    });

    if (selected) {
      const modelValue = selected.label.includes('auto') ? 'auto' : 
                        selected.label.includes('fast') ? 'fast' : 'advanced';
      await ConfigManager.updateConfig('model', modelValue);
      vscode.window.showInformationMessage(`已切换到 ${modelValue} 模型`);
    }
  }

  private static async showSnoozePicker() {
    const options = [
      { label: '5分钟', minutes: 5 },
      { label: '15分钟', minutes: 15 },  
      { label: '30分钟', minutes: 30 },
      { label: '1小时', minutes: 60 },
      { label: '2小时', minutes: 120 }
    ];

    const selected = await vscode.window.showQuickPick(options, {
      title: 'Snooze',
      placeHolder: '选择暂停时长'
    });

    if (selected) {
      const snoozeUntil = Date.now() + (selected.minutes * 60 * 1000);
      await ConfigManager.updateConfig('snoozeUntil', snoozeUntil);
      vscode.window.showInformationMessage(`AI补全已暂停 ${selected.label}`);
    }
  }
}