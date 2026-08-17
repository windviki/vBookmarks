import { describe, it, expect } from 'vitest';
import { makeI18n } from './helpers/i18n.js';

// 参数化文案的真实替换契约 (en baseline).
//
// en 文案用命名占位符 ($count$ / $title$ …)，messages.json 的 `placeholders`
// 表把它们映射到位置参数 (content: "$1"/"$2")。这些断言验证"运行时替换后
// 用户看到的最终英文文案"——补充 scripts/i18n.py verify (它只查占位符结构
// 完整性, 不查替换后的读法与位置)。subs 取值与各自模块测试里的真实调用一致。
//
// 注意: 这是 en 文案契约 —— 改 en 措辞会让本文件失败, 这是预期 (文案级回归门)。

const _m = makeI18n();

describe('参数化 i18n 文案的真实替换结果 (en)', () => {
    it('确认框: 非空文件夹删除 ($count$)', () => {
        expect(_m('confirmDeleteFolder', '5'))
            .toBe('This folder contains 5 item(s). You can undo the deletion.');
    });

    it('确认框: 批量打开 全部/新窗口/隐身窗口 ($count$)', () => {
        expect(_m('confirmOpenBookmarks', '11'))
            .toBe('Are you sure you want to open all 11 bookmarks?');
        expect(_m('confirmOpenBookmarksNewWindow', '3'))
            .toBe('Are you sure you want to open all 3 bookmarks in a new window?');
        expect(_m('confirmOpenBookmarksNewIncognitoWindow', '3'))
            .toBe('Are you sure you want to open all 3 bookmarks in a new incognito window?');
    });

    it('撤销 toast: 删除书签/文件夹 ($title$)', () => {
        expect(_m('deletedBookmark', 'GitHub')).toBe('Deleted GitHub');
        expect(_m('deletedFolder', 'My Folder')).toBe('Deleted folder My Folder');
    });

    it('会话保存结果 ($count$)', () => {
        expect(_m('sessionSaved', '12')).toBe('Saved 12 tabs to a new folder');
    });

    it('搜索历史结果计数 ($n$)', () => {
        expect(_m('searchHistoryResultCount', '3')).toBe('3 result(s)');
    });

    it('快速收藏 toast ($folderName$)', () => {
        expect(_m('quickAddedTo', 'Work')).toBe('Bookmark added to Work');
        expect(_m('quickRemoved')).toBe('Bookmark removed'); // 无参数
    });

    it('统计视图访问计数 ($count$)', () => {
        expect(_m('statsVisitCount', '5')).toBe('Visited 5 times');
    });

    it('清空统计确认 ($count$)', () => {
        expect(_m('statsClearConfirm', '2'))
            .toBe('Clear visit statistics for 2 bookmarks? This cannot be undone.');
    });

    it('选择模式计数 ($count$)', () => {
        expect(_m('selectCount', '1')).toBe('1 selected');
        expect(_m('selectCount', '0')).toBe('0 selected');
    });

    it('去重组头提示: 双参数 ($title$/$count$ 顺序正确)', () => {
        expect(_m('dupesCleanRestHint', ['A oldest', '2']))
            .toBe('Keep "A oldest" and remove the other 2');
    });

    it('去重确认: 组清理点名当前 keeper, 全量确认策略中立 ($title$/$count$/$groups$)', () => {
        expect(_m('dupesConfirmGroup', ['A oldest', '2']))
            .toBe('Keep "A oldest" and remove the other 2 copies?');
        expect(_m('dupesConfirmAll', ['5', '2']))
            .toBe('Remove 5 extra copies across 2 groups? The keeper selected in each group is kept.');
    });

    it('批量删除确认的 undo 粒度提示 (undoSingleStepNote 拆分)', () => {
        expect(_m('undoSingleStepNote'))
            .toBe('Undo can only restore the most recent deletion.');
        // 死链 delete-all 的第二行 = All 筛选警告 + undo 提示 (代码拼接)
        expect(_m('deadDeleteAllNote'))
            .toBe('Under the All filter this includes blocked bookmarks (reachable through your proxy, likely still alive) and previously marked rows.');
        expect(_m('deadDeleteAllNote')).not.toContain('Undo');
    });

    it('选项页命令: 删除确认/文件夹消失 (裸 $1$ 数字占位符)', () => {
        expect(_m('paletteCustomDeleteConfirm', 'work'))
            .toBe('Delete the command "work"? The change syncs to all your devices.');
        expect(_m('paletteCustomBroken', 'Work apps'))
            .toBe('The folder of command "Work apps" no longer exists. Delete the command?');
    });

    it('选项页命令用量 ($1 / $2)', () => {
        expect(_m('paletteCustomUsage', ['1', '100'])).toBe('1 / 100');
    });

    it('捐赠卡版本消息 (双占位符 $versionNumber$/$versionTips$)', () => {
        expect(_m('versionMessage', ['4.0.1', 'Github']))
            .toBe('This is new VBM 4.0.1! Changelog is here: Github');
    });

    it('批量工具 toast: 历史导入/去重/死链删除 ($count$)', () => {
        expect(_m('statsHistoryImported', '8')).toBe('Imported past visits for 8 bookmarks');
        expect(_m('dupesDone', '2')).toBe('Removed 2 duplicate bookmarks');
        expect(_m('deadDeleted', '8')).toBe('Deleted 8 dead bookmarks');
    });

    it('面板桥接行/去重按钮/死链开始提示', () => {
        expect(_m('paletteCmdSearchInView', 'gmail')).toBe("Search 'gmail' in Search view");
        expect(_m('dupesApplyAll', '3')).toBe('Apply all (3)');
        expect(_m('deadStartHint', '42')).toBe('Start scanning 42 bookmarks');
    });
});

describe('makeI18n 边界', () => {
    it('未知 key 回显 (与缺失 locale 行为一致)', () => {
        expect(_m('noSuchKeyAnywhere')).toBe('noSuchKeyAnywhere');
    });

    it('无参数时返回完整文案, 不留下 $name$ 残渣', () => {
        expect(_m('deletedBookmark')).toBe('Deleted $title$'); // 无 sub → 原样
        expect(_m('confirmDeleteFolder')).toBe('This folder contains $count$ item(s). You can undo the deletion.');
    });
});
