// IPP/1.1 wire constants (RFC 8010, RFC 8011, PWG 5100.x).

export const DelimiterTag = {
  operationAttributes: 0x01,
  jobAttributes: 0x02,
  endOfAttributes: 0x03,
  printerAttributes: 0x04,
  unsupportedAttributes: 0x05,
} as const;

export const ValueTag = {
  // Out-of-band values carry no data.
  unsupported: 0x10,
  unknown: 0x12,
  noValue: 0x13,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  textWithoutLanguage: 0x41,
  nameWithoutLanguage: 0x42,
  keyword: 0x44,
  uri: 0x45,
  uriScheme: 0x46,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const;

export const Operation = {
  printJob: 0x0002,
  cancelJob: 0x0008,
  getJobs: 0x000a,
  getPrinterAttributes: 0x000b,
  setPrinterAttributes: 0x0013,
} as const;

export const StatusCode = {
  successfulOk: 0x0000,
  clientErrorNotFound: 0x0406,
} as const;

export const PrinterStateEnum = { idle: 3, processing: 4, stopped: 5 } as const;

export const JobStateEnum = {
  3: 'pending',
  4: 'held',
  5: 'processing',
  6: 'stopped',
  7: 'canceled',
  8: 'aborted',
  9: 'completed',
} as const;
