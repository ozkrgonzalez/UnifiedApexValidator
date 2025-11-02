# Step 6 · Connect Your Default Org

Run the Salesforce CLI command:

```bash
sf org login web --alias myOrg
```

Verify the org appears in `sf org list` and is marked as the default. UAV will use this default org when validating or comparing metadata.
