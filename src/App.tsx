import { Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import HomePage from "./pages/HomePage";
import ExamPage from "./pages/ExamPage";
import BankPage from "./pages/BankPage";
import AnswersPage from "./pages/AnswersPage";
import ResultPage from "./pages/ResultPage";
import RecordsPage from "./pages/RecordsPage";
import MistakesPage from "./pages/MistakesPage";
import ImportPage from "./pages/ImportPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="/sets/:setId/exam" element={<ExamPage />} />
        <Route path="/exam/:attemptId" element={<ExamPage />} />
        <Route path="/sets/:setId/answers" element={<AnswersPage />} />
        <Route path="/bank" element={<BankPage />} />
        <Route path="/attempts/:attemptId" element={<ResultPage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/mistakes" element={<MistakesPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<HomePage />} />
      </Route>
    </Routes>
  );
}
