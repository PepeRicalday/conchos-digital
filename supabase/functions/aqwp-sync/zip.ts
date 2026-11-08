// ZIP de UN archivo (como lo entrega Export/DataSet/Csv) → texto. Sin dependencias: DecompressionStream
// existe en Deno y en Node ≥ 18. Un ZIP vacío (22 bytes, solo directorio final) = sin datos.
export async function descomprimirPrimero(buf: Uint8Array): Promise<string> {
  if (buf.length < 40) return "";
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error("La respuesta no es un ZIP");
  const metodo = dv.getUint16(8, true);
  const comprimido = dv.getUint32(18, true);
  const nl = dv.getUint16(26, true), el = dv.getUint16(28, true);
  const datos = buf.slice(30 + nl + el, 30 + nl + el + comprimido);
  if (metodo === 0) return new TextDecoder().decode(datos); // almacenado
  if (metodo !== 8) throw new Error(`Método ZIP no soportado: ${metodo}`);
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(flujo).text();
}
