// Ayuda común de los e2e de la vista Cuenca del Conchos. El panel tiene 4 pestañas (Resumen, Vasos, Balance, Clima) con
// secciones plegables. Los nombres de las 6 pestañas de antes se aceptan: abren la pestaña que hoy contiene ese bloque.
const DONDE = {
  Resumen: 'Resumen', Vasos: 'Vasos', Balance: 'Balance', Clima: 'Clima',
  Presas: 'Vasos', 'Vasos por satélite': 'Vasos', 'Red y estaciones': 'Resumen', 'Cierres y balance': 'Balance', 'Clima y lluvia': 'Clima',
};
/** Abre todas las secciones plegadas de la pestaña actual (el contenido se monta al abrir). */
export async function abrirSecciones(page) {
  for (let i = 0; i < 12; i++) {
    const cerrada = page.locator('.cu-root details.cu-sec:not([open]) > summary').first();
    if (!(await cerrada.count())) break;
    await cerrada.click();
    await page.waitForTimeout(250);
  }
}
export async function irA(page, nombre) {
  const pestana = DONDE[nombre] ?? nombre;
  const btn = page.locator(`.cu-nav-btn:text-is("${pestana}")`).first();
  await btn.waitFor({ timeout: 45000 });
  if ((await btn.getAttribute('aria-current')) !== 'page') await btn.click();
  await page.waitForTimeout(500);
  await abrirSecciones(page);
  await page.waitForTimeout(500);
}
