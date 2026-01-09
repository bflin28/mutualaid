import { useState } from "react";
import { LogRescue } from "./components/LogRescue";
import { RescueStats } from "./components/RescueStats";
import { Toaster } from "./components/ui/sonner";
import { Leaf, FileText, BarChart3 } from "lucide-react";

interface RescueItem {
  id: string;
  item: string;
  qty: string;
  unit: string;
  category: string;
}

interface Rescue {
  id: string;
  rescuedFrom: string;
  dropOffTo: string;
  date: string;
  items: RescueItem[];
}

export default function App() {
  const [rescues, setRescues] = useState<Rescue[]>([]);
  const [activeTab, setActiveTab] = useState<"log" | "stats">("log");

  const handleRescueLogged = (rescue: {
    rescuedFrom: string;
    dropOffTo: string;
    date: string;
    items: RescueItem[];
  }) => {
    const newRescue: Rescue = {
      id: Date.now().toString(),
      ...rescue,
    };
    setRescues([...rescues, newRescue]);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Toaster />

      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-600 rounded-lg">
              <Leaf className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-gray-900 font-semibold">Chicago Food</h1>
              <h1 className="text-gray-900 font-semibold">Sovereignty</h1>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <button
            onClick={() => setActiveTab("log")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              activeTab === "log"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <FileText className="w-5 h-5" />
            <span>Log Rescue</span>
          </button>

          <button
            onClick={() => setActiveTab("stats")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              activeTab === "stats"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span>View Stats</span>
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-8">
          {activeTab === "log" ? (
            <LogRescue onRescueLogged={handleRescueLogged} />
          ) : (
            <RescueStats rescues={rescues} />
          )}
        </div>
      </main>
    </div>
  );
}