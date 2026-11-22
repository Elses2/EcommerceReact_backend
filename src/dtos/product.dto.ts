import type { Category } from "../models/category.model.js";
import type { Product } from "../models/product.model.js";

// ProductView: lo que recibe la vista — producto + categorías N:M + atributos derivados
export interface ProductView extends Product {
  categories: Category[];
  inStock: boolean;
  imageUrl: string;
}

/** Vista de detalle de producto con productos relacionados (spec §6.8). */
export interface ProductDetailView {
  product: ProductView;
  related: ProductView[];
}
