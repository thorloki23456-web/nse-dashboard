import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OptionChainDiff } from "@/lib/types";
import { GitCommit } from "lucide-react";

interface OptionChainDiffTableProps {
  diffData: OptionChainDiff[];
}

const formatDiff = (value: number) => {
  const kValue = (value / 1000).toFixed(1);
  if (value > 0) return <span className="text-green-500">+{kValue}k</span>;
  if (value < 0) return <span className="text-red-500">{kValue}k</span>;
  return <span>{kValue}k</span>;
};



export default function OptionChainDiffTable({ diffData }: OptionChainDiffTableProps) {
  const filteredData = diffData.filter(d =>
    d.ce_oi_diff !== 0 ||
    d.pe_oi_diff !== 0 ||
    d.ce_vol_diff !== 0 ||
    d.pe_vol_diff !== 0
  );

  if (filteredData.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCommit className="h-6 w-6 text-primary" />
          <span>OI & Volume Deltas (vs. last 15s)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left text-red-400">CALLS</TableHead>
                <TableHead className="text-left"></TableHead>
                <TableHead className="text-center font-bold text-lg bg-muted/50 rounded-md">
                  Strike
                </TableHead>
                <TableHead className="text-right"></TableHead>
                <TableHead className="text-right text-green-400">PUTS</TableHead>
              </TableRow>
              <TableRow>
                <TableHead className="text-left">ΔOI</TableHead>
                <TableHead className="text-left">ΔVol</TableHead>
                <TableHead className="text-center bg-muted/50 rounded-md"></TableHead>
                <TableHead className="text-right">ΔVol</TableHead>
                <TableHead className="text-right">ΔOI</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.map((diff) => (
                <TableRow key={diff.strike}>
                  <TableCell className="text-left">{formatDiff(diff.ce_oi_diff)}</TableCell>
                  <TableCell className="text-left">{formatDiff(diff.ce_vol_diff)}</TableCell>
                  <TableCell className="text-center font-bold text-lg bg-muted/50 rounded-md">
                    {diff.strike}
                  </TableCell>
                  <TableCell className="text-right">{formatDiff(diff.pe_vol_diff)}</TableCell>
                  <TableCell className="text-right">{formatDiff(diff.pe_oi_diff)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}