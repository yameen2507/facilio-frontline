/**
 * The chat sub-router — the only file in this feature the app shell imports.
 */

import { Route, Routes } from "react-router-dom";
import { Chat } from "./pages/Chat";

export function ChatRouter() {
  return (
    <Routes>
      <Route index element={<Chat />} />
    </Routes>
  );
}
