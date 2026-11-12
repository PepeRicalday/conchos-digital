// Ayuda común de los e2e de la vista Cuenca del Conchos: el panel se organiza en pestañas (Resumen, Presas, Red y estaciones,
// Vasos por satélite, Cierres y balance, Clima y lluvia); cada prueba abre la que necesita.
export async function irA(page, nombre) {
  const btn = page.locator(`.cu-nav-btn:text-is("${nombre}")`).first();
  await btn.waitFor({ timeout: 45000 });
  if ((await btn.getAttribute('aria-current')) !== 'page') await btn.click();
  await page.waitForTimeout(700);
}
