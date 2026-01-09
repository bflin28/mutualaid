import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface RescueItem {
  id: string;
  item: string;
  qty: string;
  unit: string;
  category: string;
}

interface LogRescueProps {
  onRescueLogged: (rescue: {
    rescuedFrom: string;
    dropOffTo: string;
    date: string;
    items: RescueItem[];
  }) => void;
}

const UNITS = ["lbs", "kg", "boxes", "crates", "bags", "pieces", "bunches"];
const CATEGORIES = [
  "Produce",
  "Dairy",
  "Meat",
  "Bread",
  "Prepared Food",
  "Packaged Goods",
  "Other",
];

export function LogRescue({ onRescueLogged }: LogRescueProps) {
  const [rescuedFrom, setRescuedFrom] = useState("");
  const [dropOffTo, setDropOffTo] = useState("");
  const [date, setDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [items, setItems] = useState<RescueItem[]>([
    { id: "1", item: "", qty: "", unit: "", category: "" },
  ]);

  const addItem = () => {
    setItems([
      ...items,
      { id: Date.now().toString(), item: "", qty: "", unit: "", category: "" },
    ]);
  };

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter((item) => item.id !== id));
    }
  };

  const updateItem = (
    id: string,
    field: keyof RescueItem,
    value: string
  ) => {
    setItems(
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!rescuedFrom.trim()) {
      toast.error("Please enter where the food was rescued from");
      return;
    }

    if (!dropOffTo.trim()) {
      toast.error("Please enter where the food was dropped off");
      return;
    }

    const validItems = items.filter(
      (item) => item.item && item.qty && item.unit && item.category
    );

    if (validItems.length === 0) {
      toast.error("Please add at least one item");
      return;
    }

    onRescueLogged({
      rescuedFrom,
      dropOffTo,
      date,
      items: validItems,
    });

    // Reset form
    setRescuedFrom("");
    setDropOffTo("");
    setDate(new Date().toISOString().split("T")[0]);
    setItems([{ id: Date.now().toString(), item: "", qty: "", unit: "", category: "" }]);

    toast.success("Rescue logged successfully!");
  };

  return (
    <div className="max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="rescuedFrom" className="text-gray-700">
            Rescued From
          </Label>
          <Input
            id="rescuedFrom"
            placeholder="Type location and press Enter"
            value={rescuedFrom}
            onChange={(e) => setRescuedFrom(e.target.value)}
            className="bg-white border-gray-300"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="dropOffTo" className="text-gray-700">
            Drop Off To
          </Label>
          <Input
            id="dropOffTo"
            placeholder="Type location and press Enter"
            value={dropOffTo}
            onChange={(e) => setDropOffTo(e.target.value)}
            className="bg-white border-gray-300"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="date" className="text-gray-700">
            Date
          </Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-white border-gray-300"
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-gray-700">Items</Label>
            <Button
              type="button"
              onClick={addItem}
              size="sm"
              variant="outline"
              className="border-green-600 text-green-600 hover:bg-green-600 hover:text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </div>

          <div className="space-y-4">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="bg-white border border-gray-200 rounded-lg p-4 space-y-3 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-green-600 text-sm font-medium">
                    ITEM {index + 1}
                  </span>
                  {items.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(item.id)}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`item-${item.id}`} className="text-gray-600 text-xs">
                    ITEM
                  </Label>
                  <Input
                    id={`item-${item.id}`}
                    placeholder="Type to search..."
                    value={item.item}
                    onChange={(e) =>
                      updateItem(item.id, "item", e.target.value)
                    }
                    className="bg-gray-50 border-gray-300"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`qty-${item.id}`} className="text-gray-600 text-xs">
                      QTY
                    </Label>
                    <Input
                      id={`qty-${item.id}`}
                      type="number"
                      placeholder="0"
                      value={item.qty}
                      onChange={(e) =>
                        updateItem(item.id, "qty", e.target.value)
                      }
                      className="bg-gray-50 border-gray-300"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`unit-${item.id}`} className="text-gray-600 text-xs">
                      UNIT
                    </Label>
                    <Select
                      value={item.unit}
                      onValueChange={(value) =>
                        updateItem(item.id, "unit", value)
                      }
                    >
                      <SelectTrigger
                        id={`unit-${item.id}`}
                        className="bg-gray-50 border-gray-300"
                      >
                        <SelectValue placeholder="--" />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {unit}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`category-${item.id}`} className="text-gray-600 text-xs">
                    CATEGORY
                  </Label>
                  <Select
                    value={item.category}
                    onValueChange={(value) =>
                      updateItem(item.id, "category", value)
                    }
                  >
                    <SelectTrigger
                      id={`category-${item.id}`}
                      className="bg-gray-50 border-gray-300"
                    >
                      <SelectValue placeholder="--" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white"
        >
          Save Log
        </Button>
      </form>
    </div>
  );
}