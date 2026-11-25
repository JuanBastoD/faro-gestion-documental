import { expect, type Page } from '@playwright/test';
import type { PdfDePrueba } from './pdfs.ts';

/** Una subserie del cuadro de clasificación de demostración (la siembra la deja en toda base de desarrollo y del CI). */
export const SUBSERIE_DE_DEMOSTRACION = '100.1 · Contratos de obra';

export async function ingresar(page: Page, usuario: string, clave: string): Promise<void> {
  await page.getByLabel('Usuario').fill(usuario);
  await page.getByLabel('Clave').fill(clave);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

export const menuPrincipal = (page: Page) => page.getByRole('navigation', { name: 'Principal' });

/** Va a la pantalla de carga usando el menú (como lo haría una persona), no la dirección. */
export async function irACargar(page: Page): Promise<void> {
  await menuPrincipal(page).getByRole('link', { name: 'Cargar documento' }).click();
  await expect(page.getByRole('heading', { name: 'Cargar un documento', level: 1 })).toBeVisible();
}

export interface DatosDelFormulario {
  pdf: PdfDePrueba;
  titulo: string;
  expediente: string;
}

/** Llena el formulario de carga con el PDF en memoria (no hace falta ningún archivo en disco). */
export async function llenarFormularioDeCarga(page: Page, { pdf, titulo, expediente }: DatosDelFormulario): Promise<void> {
  await page.getByLabel(/Archivo PDF/).setInputFiles({ name: pdf.nombre, mimeType: 'application/pdf', buffer: pdf.datos });
  await page.getByLabel(/^Título/).fill(titulo);
  await page.getByLabel(/^Expediente/).fill(expediente);
  await page.getByLabel(/^Subserie/).selectOption({ label: SUBSERIE_DE_DEMOSTRACION });
  await page.getByLabel(/^Fecha del documento/).fill('2026-03-02');
}

export const pantallaDeDuplicado = (page: Page) =>
  page.getByRole('heading', { name: 'Este archivo se parece a un documento que ya existe', level: 2 });

export const listaDeCandidatos = (page: Page) => page.getByRole('group', { name: 'Elige con cuál quieres comparar' });

/** El número del documento que muestra la dirección (`/app/documentos/12`). */
export async function idDelDocumentoAbierto(page: Page): Promise<number> {
  await expect(page).toHaveURL(/\/app\/documentos\/\d+$/);
  return Number(new URL(page.url()).pathname.split('/').pop());
}

/** La tarjeta de una versión en el historial del documento. */
export const tarjetaDeVersion = (page: Page, numero: number) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: new RegExp(`^Versión ${numero}\\b`) }) });
