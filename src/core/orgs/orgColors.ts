import * as vscode from 'vscode';
import { ConnectedOrgInfo, looksLikeProduction } from '../utils';

const STORAGE_KEY = 'uav.orgColors';
const PRODUCTION_COLOR = '#E53935';

// Curated palette (production red reserved as index 0 and excluded from the
// deterministic rotation below, so a non-prod org never accidentally lands on it).
export const ORG_COLOR_PALETTE: string[] = [
    PRODUCTION_COLOR,
    '#FB8C00',
    '#FDD835',
    '#43A047',
    '#00ACC1',
    '#1E88E5',
    '#570345',
    '#8E24AA',
    '#D81B60',
    '#6D4C41',
    '#546E7A',
    '#00897B'
];

function hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
}

export function suggestColorFor(org: ConnectedOrgInfo): string {
    if (looksLikeProduction(org)) {
        return PRODUCTION_COLOR;
    }

    const rotation = ORG_COLOR_PALETTE.slice(1);
    const index = hashString(org.username) % rotation.length;
    return rotation[index];
}

export function getOrgColors(context: vscode.ExtensionContext): Record<string, string> {
    return context.globalState.get<Record<string, string>>(STORAGE_KEY, {});
}

export async function setOrgColor(context: vscode.ExtensionContext, username: string, hex: string): Promise<void> {
    const colors = getOrgColors(context);
    colors[username] = hex;
    await context.globalState.update(STORAGE_KEY, colors);
}

export function getOrgColor(context: vscode.ExtensionContext, org: ConnectedOrgInfo): string {
    const colors = getOrgColors(context);
    return colors[org.username] || suggestColorFor(org);
}

/**
 * Picks black or white foreground text for readable contrast against a hex background.
 */
export function pickForeground(hex: string): string {
    const normalized = hex.replace('#', '');
    const r = parseInt(normalized.substring(0, 2), 16);
    const g = parseInt(normalized.substring(2, 4), 16);
    const b = parseInt(normalized.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
}

/**
 * A dimmed variant of a foreground color, used for inactive activity bar icons
 * so the active view's icon still stands out against the rest.
 */
export function dimForeground(fgHex: string): string {
    const normalized = fgHex.replace('#', '');
    const r = parseInt(normalized.substring(0, 2), 16);
    const g = parseInt(normalized.substring(2, 4), 16);
    const b = parseInt(normalized.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0.6)`;
}
