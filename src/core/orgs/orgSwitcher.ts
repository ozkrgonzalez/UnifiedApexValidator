import * as vscode from 'vscode';
import { execa } from 'execa';
import { localize } from '../../i18n';
import { ConnectedOrgInfo, ListOrgsOptions, Logger, getDefaultConnectedOrg, listConnectedOrgs, looksLikeProduction, resolveSfCliPath } from '../utils';
import { dimForeground, getOrgColor, ORG_COLOR_PALETTE, pickForeground, setOrgColor } from './orgColors';

const COLOR_KEYS = [
    'statusBar.background',
    'statusBar.foreground',
    'activityBar.background'
];

let orgStatusBarItem: vscode.StatusBarItem | undefined;

async function applyWorkbenchColor(hex: string | undefined): Promise<void>
{
    const config = vscode.workspace.getConfiguration();
    const current = { ...(config.get<Record<string, string>>('workbench.colorCustomizations') || {}) };

    if (!hex)
    {
        for (const key of COLOR_KEYS)
        {
            delete current[key];
        }
    }
    else
    {
        const fg = pickForeground(hex);
        current['statusBar.background'] = hex;
        current['statusBar.foreground'] = fg;
        current['activityBar.background'] = hex;
    }

    try
    {
        await config.update('workbench.colorCustomizations', current, vscode.ConfigurationTarget.Workspace);
    }
    catch (err: any)
    {
        try
        {
            await config.update('workbench.colorCustomizations', current, vscode.ConfigurationTarget.Global);
        }
        catch
        {
            // Workspace settings has syntax errors
        }
    }
}

export function createOrgStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem
{
    orgStatusBarItem = vscode.window.createStatusBarItem('uav.orgStatus', vscode.StatusBarAlignment.Left, 99);
    orgStatusBarItem.name = localize('status.orgs.itemName', 'Unified Apex Validator - Active Org');
    orgStatusBarItem.command = 'uav.orgsView.focus';
    context.subscriptions.push(orgStatusBarItem);
    return orgStatusBarItem;
}

export async function refreshActiveOrgIndicator(context: vscode.ExtensionContext, logger?: Logger, options?: ListOrgsOptions): Promise<void>
{
    const orgs = await listConnectedOrgs(logger, { ...options, context });
    const active = orgs.find((org) => org.isDefault) || null;

    if (!active)
    {
        if (orgStatusBarItem)
        {
            orgStatusBarItem.hide();
        }
        await applyWorkbenchColor(undefined);
        return;
    }

    const hex = getOrgColor(context, active);
    await applyWorkbenchColor(hex);

    if (orgStatusBarItem)
    {
        orgStatusBarItem.text = `$(circle-large-filled) ${active.alias || active.username}`;
        orgStatusBarItem.tooltip = localize('status.orgs.tooltip', 'Active org: {0}. Click to switch.', active.alias || active.username);
        orgStatusBarItem.show();
    }
}

export async function switchToOrg(context: vscode.ExtensionContext, org: ConnectedOrgInfo, logger?: Logger): Promise<void>
{
    const sfPath = resolveSfCliPath();
    const target = org.alias || org.username;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot)
    {
        vscode.window.showErrorMessage(localize('error.orgs.noWorkspace', 'No workspace folder detected.'));
        return;
    }

    try
    {
        await execa(sfPath, ['config', 'set', `target-org=${target}`], {
            cwd: workspaceRoot,
            env: { ...process.env, FORCE_COLOR: '0' }
        });
        logger?.info(localize('log.orgs.switched', 'Switched active org to "{0}".', target));
        await refreshActiveOrgIndicator(context, logger, { forceRefresh: true, context });
        vscode.window.showInformationMessage(localize('info.orgs.switched', 'Active org switched to "{0}".', target));
    }
    catch (err: any)
    {
        const reason = err?.shortMessage || err?.stderr || err?.message || String(err);
        logger?.error(localize('log.orgs.switchFailed', 'Could not switch to org "{0}": {1}', target, reason));
        vscode.window.showErrorMessage(localize('error.orgs.switchFailed', 'Could not switch to org "{0}": {1}', target, reason));
    }
}

const PALETTE_LABELS = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Magenta', 'Pink', 'Brown', 'Blue Grey', 'Teal'];

export async function promptSetOrgColor(context: vscode.ExtensionContext, org: ConnectedOrgInfo, logger?: Logger): Promise<void>
{
    const items: vscode.QuickPickItem[] = ORG_COLOR_PALETTE.map((hex, index) => ({
        label: `$(circle-filled) ${PALETTE_LABELS[index] || hex}`,
        description: hex
    }));
    items.push({ label: localize('input.orgs.customColor', 'Custom color...'), description: '#RRGGBB' });

    const picked = await vscode.window.showQuickPick(items, {
        title: localize('input.orgs.colorPickerTitle', 'Set color for {0}', org.alias || org.username),
        ignoreFocusOut: true
    });
    if (!picked)
    {
        return;
    }

    let hex = picked.description && /^#[0-9a-fA-F]{6}$/.test(picked.description) ? picked.description : undefined;
    if (!hex)
    {
        const custom = await vscode.window.showInputBox({
            title: localize('input.orgs.customColorTitle', 'Custom color (hex)'),
            prompt: localize('input.orgs.customColorPrompt', 'Enter a hex color, e.g. #1E88E5'),
            ignoreFocusOut: true,
            validateInput: (value) => (/^#[0-9a-fA-F]{6}$/.test(value.trim()) ? null : localize('input.orgs.customColorInvalid', 'Enter a valid hex color like #1E88E5.'))
        });
        if (!custom)
        {
            return;
        }
        hex = custom.trim();
    }

    await setOrgColor(context, org.username, hex);
    logger?.info(localize('log.orgs.colorSet', 'Color set for org "{0}": {1}', org.alias || org.username, hex));
    await refreshActiveOrgIndicator(context, logger);
}

export async function pickAndSwitchOrg(context: vscode.ExtensionContext, logger?: Logger): Promise<void>
{
    const orgs = await listConnectedOrgs(logger, { context });
    if (!orgs.length)
    {
        vscode.window.showWarningMessage(localize('warning.orgs.noneConnected', 'No orgs connected. Run "sf org login web" first.'));
        return;
    }

    const items = orgs.map((org) => ({
        label: `${org.isDefault ? '$(check) ' : ''}${org.alias || org.username}`,
        description: org.username,
        org
    }));

    const picked = await vscode.window.showQuickPick(items, {
        title: localize('input.orgs.switchTitle', 'Switch active org'),
        ignoreFocusOut: true
    });
    if (!picked)
    {
        return;
    }

    await switchToOrg(context, picked.org, logger);
}

/**
 * Shows a modal confirmation before running an action against an org flagged as
 * production. Returns true when it's safe to proceed (not production, or the
 * user explicitly confirmed).
 */
export async function confirmIfProduction(logger?: Logger): Promise<boolean>
{
    const active = await getDefaultConnectedOrg(logger);
    if (!active || !looksLikeProduction(active))
    {
        return true;
    }

    const proceedLabel = localize('prompt.orgs.productionProceed', 'Continue');
    const answer = await vscode.window.showWarningMessage(
        localize(
            'warning.orgs.productionGuardrail',
            'You are about to run this against a PRODUCTION org ({0}). Continue?',
            active.alias || active.username
        ),
        { modal: true },
        proceedLabel
    );

    return answer === proceedLabel;
}
