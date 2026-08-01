import * as vscode from 'vscode';
import { ConnectedOrgInfo, Logger, listConnectedOrgs } from '../utils';
import { getOrgColor } from './orgColors';

function colorIconUri(hex: string): vscode.Uri
{
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="${hex}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

export class OrgItem extends vscode.TreeItem
{
    constructor(public readonly org: ConnectedOrgInfo, hex: string)
    {
        super(org.alias || org.username, vscode.TreeItemCollapsibleState.None);
        this.description = org.alias ? org.username : undefined;
        this.iconPath = colorIconUri(hex);
        this.contextValue = 'uavOrgItem';
        this.tooltip = org.isDefault ? `${org.alias || org.username} (active)` : (org.alias || org.username);
        this.command = {
            command: 'UnifiedApexValidator.switchOrg',
            title: 'Switch Org',
            arguments: [this]
        };
    }
}

export class OrgsProvider implements vscode.TreeDataProvider<OrgItem>
{
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private readonly logger = new Logger('OrgsProvider');
    private forceRefreshNext = false;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(forceRefresh: boolean = false): void
    {
        this.forceRefreshNext = forceRefresh;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: OrgItem): vscode.TreeItem
    {
        return element;
    }

    async getChildren(): Promise<OrgItem[]>
    {
        const force = this.forceRefreshNext;
        this.forceRefreshNext = false;
        const orgs = await listConnectedOrgs(this.logger, { forceRefresh: force, context: this.context });
        return orgs.map((org) => new OrgItem(org, getOrgColor(this.context, org)));
    }
}
