import flash1 from "@/data/flash_card_1.csv?raw";
import flash2 from "@/data/flash_card_2.csv?raw";
import blue from "@/data/blue_book.csv?raw";
import { mergeWordSources } from "./words";
export const words = mergeWordSources({
  flash_card_1: flash1,
  flash_card_2: flash2,
  blue_book: blue,
});
