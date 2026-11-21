import type { Category } from "../models/category.model.js";
import type { ProductView } from "./product.dto.js";

/**
 * @fileoverview DTOs de lecturas del home y categorías (spec §6.6/§6.6b/§6.7/§6.9).
 *
 * HomeView agrupa los tres bloques del home (§6.6b banners, §6.6 sugeridos,
 * §6.7 más pedidos) en una sola respuesta JSON. CategoryView cruza una
 * categoría con sus productos para la lectura de categoría (§6.8).
 */

/** Vista del home: lo que devuelve GET /api/home (JSON). */
export interface HomeView {
  banners: Array<{
    title: string;
    subtitle?: string;
    imageUrl: string;
    linkUrl?: string;
  }>;
  suggested: ProductView[];
  mostOrdered: ProductView[];
}

/** Vista de categoría con sus productos: lo que devuelve GET /api/categories/:id (JSON). */
export interface CategoryView {
  category: Category;
  products: ProductView[];
}
