// ZPL for the admin test print: a 4x6 label (812 x 1218 dots at 203 dpi).

export interface TestLabelInfo {
  printedAt: Date;
  darkness: number | null;
  speed: number | null;
  timeZone?: string;
}

/** ZPL field data cannot contain the ^ or ~ command prefixes. */
function fieldData(text: string): string {
  return text.replace(/[\^~]/g, ' ');
}

function formatDateTime(at: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(at);
}

export function testLabelZpl(info: TestLabelInfo): string {
  const darkness = info.darkness === null ? 'printer default' : String(info.darkness);
  const speed = info.speed === null ? 'printer default' : `${info.speed} in/s`;
  const stamp = info.printedAt.toISOString().replace(/[-:]/g, '').slice(0, 13); // e.g. 20260925T1830
  return [
    '^XA',
    '^CI28', // UTF-8 field data
    '^PW812',
    '^LL1218',
    '^LH0,0',
    // Border 20 dots in from each edge.
    '^FO20,20^GB772,1178,6^FS',
    '^FO40,90^FB732,1,0,C^A0N,64,64^FDECO Label Studio test^FS',
    '^FO60,190^GB692,3,3^FS',
    `^FO60,230^A0N,40,40^FD${fieldData(formatDateTime(info.printedAt, info.timeZone))}^FS`,
    `^FO60,300^A0N,40,40^FDDarkness: ${fieldData(darkness)}^FS`,
    `^FO60,360^A0N,40,40^FDSpeed: ${fieldData(speed)}^FS`,
    // Code 128, 3-dot modules, human-readable line below.
    `^FO80,460^BY3,3,160^BCN,160,Y,N,N^FDECO-${stamp}^FS`,
    // QR code, model 2, magnification 8.
    '^FO300,760^BQN,2,8^FDQA,https://eco-printer.local^FS',
    '^FO40,1110^FB732,1,0,C^A0N,32,32^FDIf this prints cleanly, the printer is working.^FS',
    '^XZ',
    '',
  ].join('\n');
}
