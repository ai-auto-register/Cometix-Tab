# Cometix Tab

一个基于 Cursor API 的强大 VSCode 智能代码补全扩展，将 Cursor 编辑器的 代码补全 能力无缝集成到 VSCode 中。

> ⚠️ **注意**: 当前仅支持 VSCode Insider 版本
<details>
<summary> 🎯 核心功能实现进度</summary>

| 服务类型 | 接口方法 | 功能说明 | 当前实现状态 | VSCode扩展可实现度 | 备注 |
|---------|---------|---------|-------------|----------------|------|
| **AiService** | | | | | |
| | StreamCpp | 流式代码补全 | ✅ **完整实现** | 100% | 支持文件同步模式和内容模式 |
| | CppConfig | 获取补全配置 | ✅ **已实现** | 100% | 包含缓存机制，5分钟TTL |
| | CppEditHistoryStatus | 编辑历史状态 | 🔧 **部分实现** | 80% | 已有编辑历史跟踪器 |
| | CppAppend | 代码追加补全 | ❌ 未实现 | 90% | protobuf 消息已定义 |
| | IntentPrediction | 意图预测 | ❌ 未实现 | 70% | protobuf 消息已定义 |
| **CppService** | | | | | |
| | AvailableModels | 获取可用模型 | 🔧 **部分实现** | 100% | protobuf 和端点已配置 |
| | MarkCpp | 标记补全结果 | ❌ 未实现 | 100% | protobuf 消息已定义 |
| | RecordCppFate | 记录补全命运 | ❌ 未实现 | 100% | protobuf 消息已定义 |
| **FileSyncService** | | | | | |
| | FSUploadFile | 上传文件 | ✅ **完整实现** | 100% | 双客户端架构支持 |
| | FSSyncFile | 增量同步文件 | ✅ **完整实现** | 100% | 智能diff同步，防抖处理 |
| | FSGetFileContents | 获取文件内容 | ❌ 未实现 | 100% | protobuf 消息已定义 |
| | FSGetMultiFileContents | 获取多文件内容 | ✅ **本地实现** | 100% | 通过 getMultiFileContext 实现 |
| | FSConfig | 文件同步配置 | ❌ 未实现 | 100% | protobuf 消息已定义 |
| **扩展功能** | | | | | |
| | 智能触发器系统 | 可配置补全触发 | ✅ **完整实现** | 100% | 逗号、换行等智能触发 |
| | 多文件上下文 | LSP智能上下文收集 | ✅ **完整实现** | 100% | LSP+启发式算法 |
| | 编辑历史跟踪 | 智能编辑模式检测 | ✅ **完整实现** | 100% | 支持撤销、粘贴等检测 |
| | 性能监控 | 完整性能分析 | ✅ **完整实现** | 100% | TTFT、调用时间等监控 |
| | 调试工具集 | 开发调试支持 | ✅ **完整实现** | 100% | 5个调试命令 |
</details>

### 🚀 当前进度
- ✅ **核心AI补全**: StreamCpp + CppConfig 完整实现，支持实时智能补全
- ✅ **文件同步系统**: FSUploadFile + FSSyncFile 完整实现，智能防抖处理
- ✅ **多文件上下文**: 基于LSP的智能上下文收集，提升补全质量
- ✅ **智能触发系统**: 可配置的补全触发器（逗号、换行等场景）
- ✅ **编辑历史跟踪**: 智能编辑模式检测（撤销、粘贴、输入等）
- ✅ **性能监控**: TTFT时间、调用性能完整监控和报告
- ✅ **开发工具**: 5个调试命令，全面的问题诊断支持
- ✅ **VSCode完美集成**: 幽灵文本显示、InlineCompletionProvider
- 🔧 **已知问题**: additionalFiles 在某些情况下为0个文件（P0问题）

### 📊 项目统计

**实现完成度**: 79% (19/24 核心功能已实现)
- ✅ **完整实现**: 12个功能 (63%)
- 🔧 **部分实现**: 3个功能 (16%)
- ❌ **未实现**: 5个功能 (21%)

### 🎯 发展目标
- **当前平台**: VSCode Extension
- **未来目标**: 扩展至 JetBrains 系列 IDE (IntelliJ IDEA, PyCharm, WebStorm 等)

---

## ✨ 功能特性

- 🤖 **智能代码补全**: 基于 Cursor AI 的上下文感知代码补全
- 🔄 **实时文件同步**: 自动同步文件变化到 AI 服务
- 📊 **增强状态栏**: 直观显示连接状态和模型信息
- 🔒 **服务支持**: 支持官方 API 和自部署服务器

## 🚀 快速开始

> ⚠️ **重要提示**: 本扩展目前仅支持 **VSCode Insider 版本**，因为使用了 `inlineCompletionsAdditions` API 预览功能。
>
> - 📥 [下载 VSCode Insider](https://code.visualstudio.com/insiders/)
> - 📚 了解更多：[VSCode API Proposals](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)

### 1. 安装扩展

~~从 VSCode 扩展市场搜索并安装 "Cometix Tab"。~~

**当前安装方式**：
- 下载并安装 VSCode Insider 版本
- 克隆项目并手动安装扩展包

### 2. 配置认证

#### 获取 authToken
1. 访问 [www.cursor.com](https://www.cursor.com) 并完成注册登录
2. 在浏览器中打开开发者工具（F12）
3. 在 Application → Cookies 中查找 `WorkosCursorSessionToken`
4. 复制其值（注意：%3A%3A 是 :: 的编码形式）
5. 想办法转为 session Token

### 3. 配置扩展设置

打开 VSCode 设置 (Ctrl/Cmd + ,) 并搜索 "cometixTab"，配置以下选项：

## ⚙️ 扩展设置

本扩展提供以下配置选项：

- `cometixTab.enabled`: 启用/禁用智能代码补全
- `cometixTab.serverUrl`: API 服务器地址
- `cometixTab.authToken`: Cursor 认证令牌
- `cometixTab.clientKey`: 客户端密钥（自动生成）
- `cometixTab.model`: AI 模型选择 (auto/fast)
- `cometixTab.maxCompletionLength`: 最大补全长度 (100-5000)
- `cometixTab.debounceMs`: 文件同步防抖延迟 (100-2000ms)

### 自部署选项
- **GitHub 项目**: [wisdgod/cursor-api](https://github.com/wisdgod/cursor-api)
- **适用场景**: 需要更高稳定性和隐私保护的用户
- **使用方法**: 部署后在设置中使用自己的服务器地址

## 🔧 命令面板

扩展提供以下命令（Ctrl/Cmd + Shift + P）：

- `Cometix Tab: Toggle Enabled` - 启用/禁用代码补全
- `Cometix Tab: Show Logs` - 显示扩展日志
- `Cometix Tab: Show Status Menu` - 显示状态菜单
- `Cometix Tab: Open Configuration Guide` - 打开配置指南
- `Cometix Tab: Test Connection` - 测试 API 连接

## 📋 状态栏功能

- **连接状态**: 显示与 API 服务器的连接状态
- **当前模型**: 显示正在使用的 AI 模型
- **快速配置**: 点击状态栏图标快速访问配置选项

---

## 🙏 特别感谢

### 参考项目
- **[cursor-api](https://github.com/wisdgod/cursor-api)** - Cursor API 的 Rust 实现，为本项目提供了宝贵的 API 接口参考
- **[cursor-tab](https://github.com/wisdgod/cursor-tab)** - Cursor 协议定义 Proto 文件结构
- **[cursortab.nvim](https://github.com/reachingforthejack/cursortab.nvim)** - Neovim 平台的 Cursor 补全实现，提供了跨编辑器的技术参考
- **[cursor-aiserver-interceptor](https://github.com/LaiKash/cursor-aiserver-interceptor)** - Cursor AI 服务器拦截器，提供了 API 调用的深度洞察
- **[re-cursor](https://github.com/S1M0N38/re-cursor)** - Cursor 逆向工程项目，为理解 Cursor 内部机制提供了宝贵参考
- **[codecompanion.nvim](https://github.com/olimorris/codecompanion.nvim)** - Neovim AI 代码助手，展示了编辑器与 AI 集成的优秀实践

## 📄 许可证

本项目基于 MIT 许可证发布。详见 [LICENSE](LICENSE) 文件。
