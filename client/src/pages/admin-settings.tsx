import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function AdminSettings() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [openaiKey, setOpenaiKey] = useState("");

    const handleSave = async () => {
        setLoading(true);
        try {
            if (openaiKey) {
                await apiRequest("POST", "/api/admin/config", {
                    key: "openai_api_key",
                    value: openaiKey
                });
            }
            toast({ title: "Settings Saved", description: "Configuration updated successfully." });
            setOpenaiKey(""); // Clear local state for security
        } catch (error) {
            toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
                    <p className="text-muted-foreground">Configure AI providers and system preferences.</p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    <Card className="bg-white/5 border-white/10">
                        <CardHeader>
                            <CardTitle>AI Providers</CardTitle>
                            <CardDescription>Enter API keys for the services you want to use.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="openai">OpenAI API Key</Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="openai"
                                        type="password"
                                        placeholder="sk-..."
                                        value={openaiKey}
                                        onChange={(e) => setOpenaiKey(e.target.value)}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">Keys are stored securely and never returned to the client.</p>
                            </div>

                            <Button onClick={handleSave} disabled={loading}>
                                <Save className="w-4 h-4 mr-2" />
                                {loading ? "Saving..." : "Save Configuration"}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </AdminLayout>
    );
}
