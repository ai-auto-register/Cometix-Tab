import * as vscode from 'vscode';
import { ConfigManager } from './utils/config';
import { Logger } from './utils/logger';
import { CryptoUtils } from './utils/crypto';
import { CursorApiClient } from './core/api-client';
import { ConnectRpcApiClient } from './core/connect-rpc-api-client';
import { ConnectRpcAdapter } from './adapters/connect-rpc-adapter';
import { FileManager } from './core/file-manager';
import { CursorCompletionProvider } from './core/completion-provider';
import { StatusBar } from './ui/status-bar';
import { StatusIntegration } from './core/status-integration';
import { ConfigValidator } from './utils/config-validator';
import { debugAuthCommand } from './commands/debug-auth';
import { debugCompletionCommand } from './commands/debug-completion';
import { debugEditHistoryCommand, setEditHistoryTracker } from './commands/debug-edit-history';
import { setLogLevelCommand } from './commands/set-log-level';
import { debugSmartEdit } from './commands/debug-smart-edit';
import { showPerformanceReport } from './commands/show-performance-report';
import { runAllTests } from './test/diff-test';
import { createPerformanceMonitor, getPerformanceMonitor } from './utils/performance-monitor';
import { createBatchSyncManager, getBatchSyncManager } from './utils/batch-sync-manager';
import { FileSyncStateManager } from './core/filesync-state-manager';
import { promptAndPatchIfNeeded } from './utils/product-json-patcher';

let logger: Logger;
let apiClient: CursorApiClient;
let connectRpcClient: ConnectRpcApiClient;
let connectRpcAdapter: ConnectRpcAdapter;
let fileManager: FileManager;
let completionProvider: CursorCompletionProvider;
let statusBar: StatusBar;
let statusIntegration: StatusIntegration;
let fileSyncStateManager: FileSyncStateManager;

export async function activate(context: vscode.ExtensionContext) {
	logger = Logger.getInstance();
	logger.info('🚀 Activating Cometix Tab extension...');
	console.log('🚀 Cometix Tab: Extension activation started');

	try {
		// 在原始ID构建下，尝试启用所需的提案 API（例如 inlineCompletionsAdditions）
		try {
			const patchEnabled = (process.env.ENABLE_PRODUCT_PATCH ?? 'true') !== 'false';
			if (patchEnabled) {
				const pkg: any = require('../package.json');
				const extId = `${pkg.publisher}.${pkg.name}`;
				const proposals: string[] = Array.isArray(pkg.enabledApiProposals) ? pkg.enabledApiProposals : ['inlineCompletionsAdditions'];
				await promptAndPatchIfNeeded(extId, proposals);
			}
		} catch (e) {
			console.warn('Product.json patch check failed', e);
		}

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
			timeout: 15000 // 🚀 优化：减少超时时间
		});
		
		// 🔧 设置 EditHistoryTracker 引用用于调试
		setEditHistoryTracker(connectRpcClient.getEditHistoryTracker());

		// 🔧 初始化CppConfig配置
		await connectRpcClient.initializeCppConfig();
		
		// 创建适配器
		connectRpcAdapter = new ConnectRpcAdapter(connectRpcClient);
		
		// 初始化文件同步状态管理器
		fileSyncStateManager = new FileSyncStateManager();
		
		// 初始化性能监控器
		const performanceMonitor = createPerformanceMonitor();
		
		// 初始化批处理同步管理器
		const batchSyncManager = createBatchSyncManager(apiClient, fileSyncStateManager);
		
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
		
		// 创建状态栏
		statusBar = new StatusBar(context);
		
		// 建立状态栏与集成系统的关联
		statusIntegration.setStatusBar(statusBar);
		
		// 注册命令
		const toggleCommand = vscode.commands.registerCommand('cometix-tab.toggleEnabled', async () => {
			const currentConfig = ConfigManager.getConfig();
			const newEnabled = !currentConfig.enabled;
			await ConfigManager.updateConfig('enabled', newEnabled);
			
			logger.info(`🔧 扩展${newEnabled ? '启用' : '禁用'}: ${newEnabled}`);
			
			// 更新状态栏显示
			if (statusBar) {
				statusBar.updateStatus();
			}
			
			// 显示用户友好的消息
			const message = newEnabled ? '✅ Cometix Tab 已启用' : '🚫 Cometix Tab 已禁用';
			vscode.window.showInformationMessage(message);
		});
		
		const showLogsCommand = vscode.commands.registerCommand('cometix-tab.showLogs', () => {
			logger.show();
		});
		
		// showStatusMenu命令现在由StatusBar自动处理
		// const showStatusMenuCommand 不再需要，因为状态栏内部已经处理了

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

		// 调试编辑历史命令
		const debugEditHistoryCommand_ = vscode.commands.registerCommand('cometix-tab.debugEditHistory', debugEditHistoryCommand);
		
		// 调试智能编辑检测命令
		const debugSmartEditCommand_ = vscode.commands.registerCommand('cometix-tab.debugSmartEdit', debugSmartEdit);
		
		// 性能报告命令
		const showPerformanceReportCommand_ = vscode.commands.registerCommand('cometix-tab.showPerformanceReport', showPerformanceReport);

		// 测试幽灵文本命令
		const testGhostTextCommand = vscode.commands.registerCommand('cometix-tab.testGhostText', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('没有活动的编辑器');
				return;
			}

			logger.info('🧪 手动测试幽灵文本补全');
			logger.info(`📄 当前文件: ${editor.document.fileName}`);
			logger.info(`📍 光标位置: ${editor.selection.active.line}:${editor.selection.active.character}`);
			
			// 检查 VSCode 设置
			const inlineSuggestEnabled = vscode.workspace.getConfiguration('editor').get('inlineSuggest.enabled');
			const showToolbar = vscode.workspace.getConfiguration('editor').get('inlineSuggest.showToolbar');
			
			logger.info(`⚙️ VSCode 内联建议设置:`);
			logger.info(`   enabled: ${inlineSuggestEnabled}`);
			logger.info(`   showToolbar: ${showToolbar}`);
			
			// 直接测试我们的补全提供者
			try {
				const token = new (vscode as any).CancellationTokenSource().token;
				const items = await completionProvider.provideInlineCompletionItems(
					editor.document,
					editor.selection.active,
					{ 
						triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
						selectedCompletionInfo: undefined,
						requestUuid: 'test-uuid',
						requestIssuedDateTime: Date.now()
					} as any,
					token
				);
				
				if (Array.isArray(items)) {
					logger.info(`🔍 直接调用补全提供者结果: ${items.length} 个项目`);
					if (items.length > 0) {
						logger.info(`📝 第一个项目预览: "${items[0].insertText.toString().substring(0, 50)}..."`);
					}
				} else if (items && 'items' in items) {
					logger.info(`🔍 直接调用补全提供者结果: ${items.items.length} 个项目`);
					if (items.items.length > 0) {
						logger.info(`📝 第一个项目预览: "${items.items[0].insertText.toString().substring(0, 50)}..."`);
					}
				} else {
					logger.info(`🔍 直接调用补全提供者结果: 无项目`);
				}
			} catch (error) {
				logger.error('❌ 直接调用补全提供者失败', error as Error);
			}

			// 手动触发补全
			await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
			vscode.window.showInformationMessage('🎭 已手动触发幽灵文本补全，请查看输出面板');
		});
		
		// 添加简单插入模式测试
		const testSimpleInsertCommand = vscode.commands.registerCommand('cometix-tab.testSimpleInsert', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('没有活动的编辑器');
				return;
			}
			
			logger.info('🧪 测试简单插入模式补全');
			
			// 创建一个简单的插入补全项目
			const simpleItem = new vscode.InlineCompletionItem('console.log("Hello World!");');
			
			// 手动显示这个补全
			try {
				// 这将直接在当前位置插入文本作为测试
				const edit = new vscode.WorkspaceEdit();
				edit.insert(editor.document.uri, editor.selection.active, '\n// 测试插入: ' + simpleItem.insertText);
				await vscode.workspace.applyEdit(edit);
				
				vscode.window.showInformationMessage('✅ 简单插入测试完成 - 如果你看到这行文本，说明基本的VSCode编辑功能正常');
			} catch (error) {
				logger.error('❌ 简单插入测试失败', error as Error);
			}
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
		
		// 注册测试file_diff_histories命令
		const testFileDiffCommand = vscode.commands.registerCommand('cometix-tab.testFileDiff', async () => {
			const { testFileDiffHistories } = await import('./commands/test-file-diff.js');
			await testFileDiffHistories();
		});

		// 设置日志级别命令
		const setLogLevelCommand_ = vscode.commands.registerCommand('cometix-tab.setLogLevel', setLogLevelCommand);

		// 新增命令：刷新CppConfig配置
		const refreshConfigCommand = vscode.commands.registerCommand('cometix-tab.refreshCppConfig', async () => {
			try {
				vscode.window.showInformationMessage('🔄 正在刷新服务器配置...');
				await connectRpcClient.initializeCppConfig();
				vscode.window.showInformationMessage('✅ 服务器配置刷新完成');
			} catch (error) {
				logger.error('❌ 刷新配置失败', error as Error);
				vscode.window.showErrorMessage('❌ 配置刷新失败，请查看日志了解详情');
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

		// 新增命令：手动触发补全
		const manualTriggerCompletionCommand = vscode.commands.registerCommand('cometix-tab.manualTriggerCompletion', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage('没有活动的编辑器');
				return;
			}

			logger.info('🎯 手动触发AI代码补全');
			
			// 手动触发VSCode的内联补全建议
			try {
				await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
				logger.info('✅ 手动触发补全命令已执行');
			} catch (error) {
				logger.error('❌ 手动触发补全失败', error as Error);
				vscode.window.showErrorMessage('触发补全失败，请查看日志');
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
			statusBar,
			statusIntegration,
			toggleCommand,
			showLogsCommand,
			showModelPickerCommand,
			showSnoozePickerCommand,
			cancelSnoozeCommand,
			openConfigurationCommand,
			debugAuthCommand_,
			debugCompletionCommand_,
			debugEditHistoryCommand_,
			debugSmartEditCommand_,
			showPerformanceReportCommand_,
			testGhostTextCommand,
			testSimpleInsertCommand,
			testDiffAlgorithmCommand,
			testFileDiffCommand,
			setLogLevelCommand_,
			refreshConfigCommand,
			testConnectionCommand,
			manualTriggerCompletionCommand,
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
	
	// 清理资源
	fileManager?.dispose();
	statusBar?.dispose();
	statusIntegration?.dispose();
	
	// 清理性能监控器
	const performanceMonitor = getPerformanceMonitor();
	performanceMonitor?.dispose();
	
	// 清理批处理管理器
	const batchSyncManager = getBatchSyncManager();
	batchSyncManager?.dispose();
	
	logger?.dispose();
	
	logger?.info('Extension deactivated');
}

// updateStatusBar 函数已被 EnhancedStatusBar 替代，不再需要

async function showModelSelector(): Promise<void> {
	const config = ConfigManager.getConfig();
	const currentModel = config.model || 'auto';
	
	try {
		// 🚀 使用新的 AvailableModels API 获取可用模型
		const modelsData = await apiClient.getAvailableModels(false);
		
		let models: Array<{label: string; description: string; picked: boolean; value: string}>;
		
		if (modelsData && modelsData.models.length > 0) {
			// 使用 API 返回的模型列表
			models = [
				{
					label: '$(auto-fix) auto',
					description: '自动选择最适合的模型',
					picked: currentModel === 'auto',
					value: 'auto'
				}
			];
			
			// 添加 API 返回的模型
			modelsData.models.forEach(model => {
				let icon = '$(gear)';
				let description = `AI模型: ${model}`;
				
				// 为常见模型添加特定图标
				if (model.includes('fast')) {
					icon = '$(zap)';
					description = '快速响应，适合简单补全';
				} else if (model.includes('advanced') || model.includes('fusion')) {
					icon = '$(rocket)';
					description = '高级模型，适合复杂代码生成';
				}
				
				// 标记默认模型
				if (model === modelsData.defaultModel) {
					description += ' (服务器推荐)';
				}
				
				models.push({
					label: `${icon} ${model}`,
					description,
					picked: currentModel === model,
					value: model
				});
			});
			
			logger?.info(`📋 从服务器获取到 ${modelsData.models.length} 个可用模型: ${modelsData.models.join(', ')}`);
		} else {
			// 回退到硬编码模型列表
			logger?.warn('⚠️ 无法从服务器获取模型列表，使用默认模型选项');
			models = [
				{
					label: '$(auto-fix) auto (默认)',
					description: '自动选择最适合的模型',
					picked: currentModel === 'auto',
					value: 'auto'
				},
				{
					label: '$(zap) fast',
					description: '快速响应，适合简单补全',
					picked: currentModel === 'fast',
					value: 'fast'
				},
				{
					label: '$(rocket) advanced',
					description: '高级模型，适合复杂代码生成',
					picked: currentModel === 'advanced',
					value: 'advanced'
				}
			];
		}

		const selected = await vscode.window.showQuickPick(models, {
			title: '🤖 选择AI补全模型',
			placeHolder: `当前模型: ${currentModel}`
		});

		if (selected) {
			await ConfigManager.updateConfig('model', selected.value);
			vscode.window.showInformationMessage(`✅ 已切换到 ${selected.value} 模型`);
			logger?.info(`🔄 AI模型已切换: ${currentModel} → ${selected.value}`);
		}
		
	} catch (error) {
		logger?.error('❌ 显示模型选择器失败', error as Error);
		vscode.window.showErrorMessage(`❌ 模型选择失败: ${(error as Error).message}`);
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
