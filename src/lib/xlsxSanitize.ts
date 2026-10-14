// Pure helpers that remove Excel "table" objects (ListObjects) from an .xlsx package.
// Why: the workbook reader (ExcelJS) can fail on some table definitions, but tables carry no data the
// import needs – the cell values are stored in the sheets themselves. Used only as a retry fallback.

/** Removes the <tableParts> element from a worksheet XML. */
export function stripTableParts(sheetXml: string): string {
  return sheetXml.replace(/<tableParts\b[^>]*?(?:\/>|>[\s\S]*?<\/tableParts>)/g, '');
}

/** Removes relationships that point to table parts from a worksheet .rels file. */
export function stripTableRels(relsXml: string): string {
  return relsXml.replace(/<Relationship\b[^>]*?\/relationships\/table"[^>]*?\/>/g, '')
                .replace(/<Relationship\b[^>]*?Target="[^"]*tables\/[^"]*"[^>]*?\/>/g, '');
}

/** Removes the content-type overrides of table parts from [Content_Types].xml. */
export function stripTableContentTypes(ctXml: string): string {
  return ctXml.replace(/<Override\b[^>]*?PartName="\/xl\/tables\/[^"]*"[^>]*?\/>/g, '');
}

export const isTablePart = (path: string): boolean => /^xl\/tables\//.test(path);
