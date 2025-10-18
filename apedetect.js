const text = `/**
 * @description  Permite consultar cualquier Custom Setting tipo LIST de forma genérica.
 * @author       Oscar González
 * @since        2025-10-08
 * @testClass    BE_GenericCustomSettingControllerTest
 */
public without sharing class BE_GenericCustomSettingController
{
    /**
     * Consulta genérica para Custom Settings tipo LIST.
     * @param customSettingName Nombre del objeto (ej: 'BE_MotivosOperacion__c')
     * @param fields Lista de campos a retornar (opcional, por defecto Name, Code__c, Description__c si existen)
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getCustomSettingData(String customSettingName, List<String> fields)
    {
        List<Map<String, Object>> result = new List<Map<String, Object>>();

        try
        {
            if (String.isBlank(customSettingName))
            {
                throw new AuraHandledException('Debe especificar el nombre del Custom Setting.');
            }

            if (fields == null || fields.isEmpty())
            {
                fields = new List<String>{'Name', 'Code__c', 'Description__c'};
            }

            String query = 'SELECT ' + String.join(fields, ', ') + ' FROM ' + customSettingName + ' ORDER BY Name';

            for (SObject rec : Database.query(query))
            {
                Map<String, Object> row = new Map<String, Object>();
                for (String fieldName : fields)
                {
                    row.put(fieldName, rec.get(fieldName));
                }
                result.add(row);
            }
        }
        catch (Exception e)
        {
            System.debug('? Error obteniendo datos del Custom Setting ' + customSettingName + ': ' + e.getMessage());
        }

        return result;
    }
}
`;

function hasDocComment(code, start) {
    if (start <= 0) return false;

    let scanPos = start;

    while (scanPos > 0) {
        const lineStart = code.lastIndexOf('\n', scanPos - 1) + 1;
        const line = code.substring(lineStart, scanPos).trim();

        if (!line) {
            scanPos = lineStart;
            continue;
        }

        if (line.startsWith('@')) {
            scanPos = lineStart;
            continue;
        }

        break;
    }

    const commentEnd = code.lastIndexOf('*/', scanPos - 1);
    if (commentEnd === -1) return false;

    const between = code.substring(commentEnd + 2, scanPos).trim();
    if (between.length > 0) return false;

    const commentStart = code.lastIndexOf('/**', commentEnd);
    return commentStart !== -1;
}

const classStart = text.indexOf('public without sharing class');
const methodStart = text.indexOf('public static List');
console.log('class', hasDocComment(text, classStart));
console.log('method', hasDocComment(text, methodStart));
