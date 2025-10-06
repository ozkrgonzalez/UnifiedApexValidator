import * as fs from 'fs-extra';
import * as pdf from 'html-pdf-node';

export async function createPdf(html: string, outputPath: string): Promise<void> {
    const file = { content: html };
    const options = {
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' }
    };

    const buffer = await pdf.generatePdf(file, options);
    await fs.writeFile(outputPath, buffer);
}
