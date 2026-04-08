# Obsidian Logseqer Plugin

[English](README.md) | 简体中文

这是一个 Obsidian 插件，目标是尽可能提供更贴近 Logseq 原生的使用体验，提升两者并用时的工作流兼容性。

## 主要功能

所有功能都可以在插件设置中单独启用/禁用，方便按需组合。

### 1. 语法检查

实时校验行是否符合 Logseq 的 `- ` 语法规范，并在状态栏显示结果。

### 2. 仓库兼容性检查

通过命令检查仓库中的日期格式、journals/pages 设置、namespace 一致性与 task markers 等问题。

> WIP：仍在持续完善，欢迎反馈与建议。

### 3. 书签同步

将 Logseq favorites 同步到 Obsidian bookmarks，支持去重，并在需要时通过手动确认创建缺失页面。

### 4. 日记增强

- 自动格式化新建日记文件
- 自定义默认反向链接查询语句

### TODO

1. 页面预览
2. 清理未使用日记

## 快速开始

1. 将插件安装到 `.obsidian/plugins/`
2. 在设置中启用社区插件
3. 在插件设置中配置文件夹路径（支持自动补全）
4. 运行 `Sync Settings` 命令同步书签

## 构建

```bash
npm install
npm run build
```

## 设置

- **功能开关**：独立启用/禁用各项功能
- **文件夹配置**：配置 Logseq 与 Obsidian 文件夹（支持自动补全）
- **反向链接查询**：自定义日记反向链接过滤语句
- **恢复默认**：将插件设置重置为默认值

## 许可证

MIT
