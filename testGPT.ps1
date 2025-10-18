# ==============================
# CONFIGURACIÓN
# ==============================
$domain = "bancoestado--devcomex.sandbox.my.salesforce.com"
$clientId = "3MVG9ETm0tIcsfrwX4bJf4oxeP818IbKf9YzGB.TZJk7w2q9SUXBE6RvGJNGiIddTAoWTXhAAGLdron.9zoDL"
$clientSecret = "F244A5F52CF98795AE18625B8C747DCF6DD66523F027DE921A27469A8930E4D7"

# ==============================
# 1. Obtener token
# ==============================
$bodyAuth = @{
    grant_type = "client_credentials"
    client_id = $clientId
    client_secret = $clientSecret
}

Write-Host "Solicitando token..."
$responseAuth = Invoke-RestMethod -Uri "https://$domain/services/oauth2/token" `
    -Method POST `
    -Body $bodyAuth

$accessToken = $responseAuth.access_token
Write-Host "Token obtenido correctamente:`n"
Write-Host $accessToken
Write-Host "`n---------------------------------------`n"

# ==============================
# 2. Llamar al modelo Einstein GPT
# ==============================
$headers = @{
    "Authorization" = "Bearer $accessToken"
    "Content-Type" = "application/json"
    "x-sfdc-app-context" = "EinsteinGPT"
    "x-client-feature-id" = "ai-platform-models-connected-app"
}

$body = @{
    prompt = "Generate a story about a financial advisor living in San Diego."
} | ConvertTo-Json

Write-Host "Enviando prompt al modelo..."
$responseModel = Invoke-RestMethod -Uri "https://api.salesforce.com/einstein/platform/v1/models/sfdc_ai__DefaultOpenAIGPT4OmniMini/generations" -Method POST -Headers $headers -Body $body

# ==============================
# 3. Mostrar resultado
# ==============================
Write-Host "`n Respuesta del modelo:`n"
$responseModel | ConvertTo-Json -Depth 5
