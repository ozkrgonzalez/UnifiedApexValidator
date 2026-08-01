# Step 4 · Configure AI Access

1. Open **Settings → Unified Apex Validator** and choose `aiProvider`: Salesforce Einstein GPT, Anthropic Claude, OpenAI, or a custom OpenAI-compatible endpoint (e.g. Mimo).
2. Run **UAV: Set AI API Key** from the Command Palette. For Einstein GPT it asks for the Connected App Client ID and Secret; for the other providers it asks for a single API key. Credentials are stored securely (VS Code Secret Storage), never written to settings.
3. For Einstein GPT, also set `sfGptEndpoint` and `sfGptModel`. For the "custom" provider, set `aiCustomEndpoint`.
4. Return to the **Dependencies** view and confirm the AI section shows **Ready**.
