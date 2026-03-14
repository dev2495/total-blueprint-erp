import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { OperatorJob } from "@/services/operator"
import { useQuery } from "@tanstack/react-query"
import { inventoryService } from "@/services/inventory"

interface JobCardProps {
    job: OperatorJob
}

export function JobCard({ job }: JobCardProps) {
    // Fetch valid input rolls (RESERVED for this job)
    const { data: reservedRolls } = useQuery({
        queryKey: ['job-input-rolls', job.id],
        queryFn: () => inventoryService.getRollStock(undefined, undefined, job.id),
        enabled: !!job.id
    })

    const inputRolls = reservedRolls || []

    return (
        <Card className="border-l-4 border-l-indigo-600 shadow-sm">
            <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                    <div>
                        <CardDescription className="text-xs font-mono uppercase tracking-widest text-indigo-500">
                            {job.job_number}
                        </CardDescription>
                        <CardTitle className="text-xl font-bold mt-1 text-slate-800">
                            {job.product_name}
                        </CardTitle>
                    </div>
                    <StatusBadge state={job.job_state} />
                </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 pt-2 text-sm">
                <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Process</label>
                    <p className="font-medium text-slate-700">{job.process_name}</p>
                </div>
                <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Target Qty</label>
                    <p className="font-mono font-bold text-slate-900 bg-slate-50 inline-block px-2 py-0.5 rounded">
                        {job.quantity} <span className="text-[10px] text-slate-500">{job.uom}</span>
                    </p>
                </div>
                <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Machine</label>
                    <p className="font-medium text-slate-700">{job.machine?.name || "Unassigned"}</p>
                </div>
                <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Sales Order</label>
                    <p className="font-medium text-slate-700 truncate">{job.sales_order_no}</p>
                </div>
                <div className="col-span-2 pt-3 border-t mt-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-2">Input Materials (Rolls)</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {inputRolls.length ? (
                            inputRolls.map((roll: any) => (
                                <div key={roll.id} className="flex flex-col gap-1.5 bg-indigo-50/30 p-2.5 rounded-lg border border-indigo-100/50">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-mono font-bold text-slate-900">{roll.label_id}</span>
                                        <Badge variant="outline" className={`text-[9px] font-bold px-1.5 py-0 ${roll.status === 'IN_PROCESS' ? 'bg-green-500 text-white border-transparent' :
                                            roll.status === 'CONSUMED' ? 'bg-slate-200 text-slate-600 border-transparent' :
                                                'bg-indigo-100 text-indigo-700 border-indigo-200'
                                            }`}>
                                            {roll.status}
                                        </Badge>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] text-slate-500 font-medium">
                                        <span>{roll.width_mm}mm × {roll.thickness_micron || '-'}µ</span>
                                        <span className="font-bold text-indigo-600">{roll.weight_kg?.toFixed(2)} KG</span>
                                    </div>
                                    <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                                        <div
                                            className="bg-indigo-500 h-full"
                                            style={{ width: `${Math.min(100, (roll.weight_kg / (roll.initial_weight || roll.weight_kg)) * 100)}%` }}
                                        />
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="px-3 py-4 border-2 border-dashed border-slate-100 rounded-lg text-center">
                                <span className="text-xs italic text-slate-400">No input rolls assigned yet.</span>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

function StatusBadge({ state }: { state: string }) {
    const map: any = {
        'RELEASED': "bg-blue-100 text-blue-700",
        'EXECUTING': "bg-green-100 text-green-700 animate-pulse",
        'PAUSED': "bg-amber-100 text-amber-700",
        'COMPLETED': "bg-slate-100 text-slate-700",
        'WAITING': "bg-yellow-50 text-yellow-600"
    }
    return (
        <Badge variant="secondary" className={`uppercase text-[10px] tracking-wider font-bold ${map[state] || ""}`}>
            {state}
        </Badge>
    )
}
