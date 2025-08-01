import * as vscode from 'vscode';
import { ConfigManager } from './utils/config';
import { Logger, LogLevel } from './utils/logger';
import { CryptoUtils } from './utils/crypto';
import { CursorApiClient } from './core/api-client';
import { ConnectRpcApiClient } from './core/connect-rpc-api-client';
import { ConnectRpcAdapter } from './adapters/connect-rpc-adapter';
import { FileManager } from './core/file-manager';
import { CursorCompletionProvider } from './core/completion-provider';
import { EnhancedStatusBar } from './ui/enhanced-status-bar';
import { StatusIntegration } from './core/status-integration';
import { ConfigValidator } from './utils/config-validator';
import { debugAuthCommand } from './commands/debug-auth';
import { debugCompletionCommand } from './commands/debug-completion';
import { runAllTests } from './test/diff-test';

let logger: Logger;
let apiClient: CursorApiClient;
let connectRpcClient: ConnectRpcApiClient;
let connectRpcAdapter: ConnectRpcAdapter;
let fileManager: FileManager;
let completionProvider: CursorCompletionProvider;
let enhancedStatusBar: EnhancedStatusBar;
let statusIntegration: StatusIntegration;

export async function activate(context: vscode.ExtensionContext) {
	logger = Logger.getInstance();
	logger.info('🚀 Activating Cometix Tab extension...');
	console.log('🚀 Cometix Tab: Extension activation started');
	
	try {
		// 详细的配置验证和调试
		logger.info('🔍 开始配置验证...');
		ConfigValidator.logCurrentConfiguration();
		
		const validation = ConfigValidator.validateConfiguration();
		if (!validation.isValid) {
			logger.error('❌ 配置验证失败');
			validation.issues.forEach(issue => logger.error(issue));
			
			// 提示用户配置，但不阻止激活
			const shouldContinue = await ConfigValidator.promptForMissingConfiguration();
			if (!shouldContinue) {
				logger.warn('⚠️ 用户选择稍后配置，扩展将以受限模式运行');
				// 继续激活扩展，但某些功能可能不可用
			}
		}
		
		// 初始化配置
		let config = ConfigManager.getConfig();
		
		// 生成客户端密钥（如果不存在）
		if (!config.clientKey) {
			config.clientKey = CryptoUtils.generateClientKey();
			ConfigManager.updateConfig('clientKey', config.clientKey);
		}
		
		// 显示配置状态
		logger.info('✅ 配置验证通过');
		validation.warnings.forEach(warning => logger.warn(warning));
		
		// 初始化核心组件
		apiClient = new CursorApiClient(config); // 默认使用 Connect RPC 实现
		
		// 初始化新的 Connect RPC 客户端
		connectRpcClient = new ConnectRpcApiClient({
			baseUrl: config.serverUrl,
			authToken: config.authToken,
			clientKey: config.clientKey,
			timeout: 30000
		});
		
		// 创建适配器
		connectRpcAdapter = new ConnectRpcAdapter(connectRpcClient);
		
		fileManager = new FileManager(apiClient, config.debounceMs);
		
		// 使用 Connect RPC 适配器
		completionProvider = new CursorCompletionProvider(connectRpcAdapter as any, fileManager);
		
		// 注册补全提供者
		const completionProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(
			{ pattern: '**' },
			completionProvider
		);
		
		// 启动文件监听
		const fileWatcherDisposables = fileManager.startWatching();
		
		// 创建状态集成系统
		statusIntegration = StatusIntegration.getInstance(context);
		
		// 创建增强状态栏
		enhancedStatusBar = new EnhancedStatusBar(context);
		
		// 建立状态栏与集成系统的关联
		statusIntegration.setStatusBar(enhancedStatusBar);
		
		// 注册命令
		const toggleCommand = vscode.commands.registerCommand('cometix-tab.toggleEnabled', async () => {
			const currentConfig = ConfigManager.getConfig();
			const newEnabled = !currentConfig.enabled;
			await ConfigManager.updateConfig('enabled', newEnabled);
			
			logger.info(`Extension ${newEnabled ? 'enabled' : 'disabled'}`);
			vscode.window.showInformationMessage(`Cometix Tab ${newEnabled ? 'enabled' : 'disabled'}`);
		});
		
		const showLogsCommand = vscode.commands.registerCommand('cometix-tab.showLogs', () => {
			logger.show();
		});
		
		// showStatusMenu命令现在由EnhancedStatusBar自动处理
		// const showStatusMenuCommand 不再需要，因为增强状态栏内部已经处理了

		// 新增命令：模型选择器
		const showModelPickerCommand = vscode.commands.registerCommand('cometix-tab.showModelPicker', async () => {
			await showModelSelector();
		});

		// 新增命令：Snooze选择器
		const showSnoozePickerCommand = vscode.commands.registerCommand('cometix-tab.showSnoozePicker', async () => {
			await showSnoozeSelector();
		});

		// 新增命令：取消Snooze
		const cancelSnoozeCommand = vscode.commands.registerCommand('cometix-tab.cancelSnooze', async () => {
			await ConfigManager.updateConfig('snoozeUntil', 0);
			vscode.window.showInformationMessage('✅ 已取消Snooze，AI补全重新启用');
		});

		// 新增命令：配置指导
		const openConfigurationCommand = vscode.commands.registerCommand('cometix-tab.openConfiguration', () => {
			ConfigManager.showConfigurationGuide();
		});

		// 调试认证命令
		const debugAuthCommand_ = vscode.commands.registerCommand('cometix-tab.debugAuth', debugAuthCommand);

		// 调试补全命令  
		const debugCompletionCommand_ = vscode.commands.registerCommand('cometix-tab.debugCompletion', debugCompletionCommand);

		// 测试幽灵文本命令
		const testGhostTextCommand = vscode.commands.registerCommand('cometix-tab.testGhostText', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('没有活动的编辑器');
				return;
			}

			// 手动触发补全
			vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
			vscode.window.showInformationMessage('🎭 已手动触发幽灵文本补全');
		});
		
		// 注册测试diff算法命令  
		const testDiffAlgorithmCommand = vscode.commands.registerCommand('cometix-tab.testDiffAlgorithm', () => {
			try {
				logger.info('🧪 开始运行diff算法测试...');
				runAllTests();
				vscode.window.showInformationMessage('✅ Diff算法测试完成！请查看输出面板获取详细结果。');
			} catch (error) {
				logger.error('❌ Diff算法测试失败', error as Error);
				vscode.window.showErrorMessage(`❌ Diff算法测试失败: ${(error as Error).message}`);
			}
		});

		// 新增命令：测试连接
		const testConnectionCommand = vscode.commands.registerCommand('cometix-tab.testConnection', async () => {
			vscode.window.showInformationMessage('🔍 正在测试 Cursor API 连接...');
			
			const result = await apiClient.testConnection();
			
			if (result.success) {
				vscode.window.showInformationMessage(result.message);
				logger.info('连接测试成功', result.details);
			} else {
				vscode.window.showErrorMessage(result.message);
				logger.error('连接测试失败', result.details);
			}
		});
		
		// 监听配置变化
		const configChangeDisposable = ConfigManager.onConfigChange(() => {
			const newConfig = ConfigManager.getConfig();
			apiClient.updateConfig(newConfig);
			fileManager.updateConfig(newConfig.debounceMs);
			// 增强状态栏会自动响应配置变化，无需手动更新
			logger.info('Configuration updated');
		});
		
		// 注册所有disposable
		context.subscriptions.push(
			completionProviderDisposable,
			...fileWatcherDisposables,
			enhancedStatusBar,
			statusIntegration,
			toggleCommand,
			showLogsCommand,
			showModelPickerCommand,
			showSnoozePickerCommand,
			cancelSnoozeCommand,
			openConfigurationCommand,
			debugAuthCommand_,
			debugCompletionCommand_,
			testGhostTextCommand,
			testDiffAlgorithmCommand,
			testConnectionCommand,
			configChangeDisposable
		);
		
		logger.info('✅ Cometix Tab extension activated successfully');
		console.log('✅ Cometix Tab: Extension activation completed');
		
		// 显示欢迎消息
		vscode.window.showInformationMessage('🎉 Cometix Tab 已启动！点击状态栏图标进行配置。');
		
	} catch (error) {
		logger.error('Failed to activate extension', error as Error);
		vscode.window.showErrorMessage(`Failed to activate Cometix Tab: ${error}`);
	}
}

export function deactivate() {
	logger?.info('Deactivating Cometix Tab extension...');
	
	fileManager?.dispose();
	enhancedStatusBar?.dispose();
	statusIntegration?.dispose();
	logger?.dispose();
	
	logger?.info('Extension deactivated');
}

// updateStatusBar 函数已被 EnhancedStatusBar 替代，不再需要

async function showModelSelector(): Promise<void> {
	const config = ConfigManager.getConfig();
	const models = [
		{
			label: '$(auto-fix) auto (默认)',
			description: '自动选择最适合的模型',
			picked: config.model === 'auto',
			value: 'auto'
		},
		{
			label: '$(zap) fast',
			description: '快速响应，适合简单补全',
			picked: config.model === 'fast',
			value: 'fast'
		},
		{
			label: '$(rocket) advanced',
			description: '高级模型，适合复杂代码生成',
			picked: config.model === 'advanced',
			value: 'advanced'
		}
	];

	const selected = await vscode.window.showQuickPick(models, {
		title: '选择AI补全模型',
		placeHolder: '选择模型类型'
	});

	if (selected) {
		await ConfigManager.updateConfig('model', selected.value);
		vscode.window.showInformationMessage(`✅ 已切换到 ${selected.value} 模型`);
	}
}

async function showSnoozeSelector(): Promise<void> {
	const options = [
		{ label: '$(clock) 5分钟', minutes: 5 },
		{ label: '$(clock) 15分钟', minutes: 15 },
		{ label: '$(clock) 30分钟', minutes: 30 },
		{ label: '$(clock) 1小时', minutes: 60 },
		{ label: '$(clock) 2小时', minutes: 120 }
	];

	const selected = await vscode.window.showQuickPick(options, {
		title: 'Snooze AI补全',
		placeHolder: '选择暂停时长'
	});

	if (selected) {
		const snoozeUntil = Date.now() + (selected.minutes * 60 * 1000);
		await ConfigManager.updateConfig('snoozeUntil', snoozeUntil);
		vscode.window.showInformationMessage(`😴 AI补全已暂停 ${selected.minutes}分钟`);
	}
}
