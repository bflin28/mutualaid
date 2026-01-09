import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Badge } from "./ui/badge";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

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

interface RescueStatsProps {
  rescues: Rescue[];
}

export function RescueStats({ rescues }: RescueStatsProps) {
  const [selectedLocation, setSelectedLocation] = useState<string>("all");

  // Get unique locations
  const locations = Array.from(
    new Set(rescues.map((rescue) => rescue.rescuedFrom))
  );

  // Filter rescues by location
  const filteredRescues =
    selectedLocation === "all"
      ? rescues
      : rescues.filter((rescue) => rescue.rescuedFrom === selectedLocation);

  // Calculate stats for "This Week"
  const today = new Date();
  const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

  const thisWeekRescues = filteredRescues.filter(
    (r) => new Date(r.date) >= oneWeekAgo
  );
  const lastWeekRescues = filteredRescues.filter(
    (r) => new Date(r.date) >= twoWeeksAgo && new Date(r.date) < oneWeekAgo
  );

  const calculateTotalWeight = (rescues: Rescue[]) => {
    return rescues.reduce((total, rescue) => {
      return (
        total +
        rescue.items.reduce((itemTotal, item) => {
          if (item.unit === "lbs") {
            return itemTotal + parseFloat(item.qty || "0");
          }
          return itemTotal;
        }, 0)
      );
    }, 0);
  };

  const thisWeekWeight = calculateTotalWeight(thisWeekRescues);
  const lastWeekWeight = calculateTotalWeight(lastWeekRescues);
  const percentChange =
    lastWeekWeight > 0
      ? ((thisWeekWeight - lastWeekWeight) / lastWeekWeight) * 100
      : 0;

  // Get top location
  const locationCounts = filteredRescues.reduce((acc, rescue) => {
    acc[rescue.rescuedFrom] = (acc[rescue.rescuedFrom] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topLocation =
    Object.entries(locationCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

  // Calculate location summary
  const locationSummary = locations.map((location) => {
    const locationRescues = filteredRescues.filter(
      (r) => r.rescuedFrom === location
    );
    const totalWeight = calculateTotalWeight(locationRescues);
    const avgWeight = totalWeight / locationRescues.length || 0;

    return {
      location,
      totalWeight,
      avgWeight,
      eventCount: locationRescues.length,
    };
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* This Week Stats */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-900">This Week</h2>
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-600 hover:text-gray-900"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-xs text-green-700 mb-1 font-medium">RESCUED</div>
            <div className="text-2xl font-semibold text-gray-900">
              {thisWeekWeight.toFixed(0)} lbs
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-xs text-blue-700 mb-1 font-medium">RESCUES</div>
            <div className="text-2xl font-semibold text-gray-900">
              {thisWeekRescues.length}
            </div>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="text-xs text-purple-700 mb-1 font-medium">TOP LOCATION</div>
            <div className="text-lg font-semibold text-gray-900 truncate">
              {topLocation}
            </div>
          </div>

          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="text-xs text-orange-700 mb-1 font-medium">VS LAST WEEK</div>
            <div
              className={`text-2xl font-semibold ${
                percentChange >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {percentChange >= 0 ? "↑" : "↓"} {Math.abs(percentChange).toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h3>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    DATE
                  </th>
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    LOCATION
                  </th>
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    DROP OFF
                  </th>
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    WEIGHT
                  </th>
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    ITEMS
                  </th>
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    SOURCE
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRescues.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="text-center py-8 text-gray-500"
                    >
                      No rescues logged yet
                    </td>
                  </tr>
                ) : (
                  filteredRescues
                    .slice()
                    .reverse()
                    .slice(0, 10)
                    .map((rescue) => {
                      const weight = calculateTotalWeight([rescue]);
                      return (
                        <tr
                          key={rescue.id}
                          className="border-b border-gray-100 hover:bg-gray-50"
                        >
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {formatDate(rescue.date)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                            {rescue.rescuedFrom}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {rescue.dropOffTo || "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {weight.toFixed(0)} lbs
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {rescue.items.length}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="secondary"
                              className="bg-orange-100 text-orange-700 border-orange-200"
                            >
                              WGOT
                            </Badge>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Location Filter */}
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">
            Location Filter
          </label>
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="max-w-xs bg-white border-gray-300">
              <SelectValue placeholder="All Locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {locations.map((location) => (
                <SelectItem key={location} value={location}>
                  {location}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-sm text-gray-600">Total locations</div>
            <div className="text-3xl font-semibold text-gray-900 mt-1">
              {locations.length}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-sm text-gray-600">Total rescue events</div>
            <div className="text-3xl font-semibold text-gray-900 mt-1">
              {filteredRescues.length}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-sm text-gray-600">Total lbs</div>
            <div className="text-3xl font-semibold text-gray-900 mt-1">
              {calculateTotalWeight(filteredRescues).toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* Locations Summary */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Locations Summary
        </h3>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    Location
                  </th>
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    Total lbs
                  </th>
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    Avg lbs/event
                  </th>
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">
                    # Events
                  </th>
                </tr>
              </thead>
              <tbody>
                {locationSummary.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="text-center py-8 text-gray-500"
                    >
                      No data available
                    </td>
                  </tr>
                ) : (
                  locationSummary.map((location) => (
                    <tr
                      key={location.location}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                        {location.location}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {location.totalWeight.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {location.avgWeight.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {location.eventCount}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}