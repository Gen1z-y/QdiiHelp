using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("QdiiHelp")]
[assembly: System.Reflection.AssemblyDescription("QdiiHelp 托盘管理程序")]
[assembly: System.Reflection.AssemblyVersion("1.1.0.0")]

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool preview = Array.IndexOf(args, "--preview") >= 0;
        bool smoke = Array.IndexOf(args, "--smoke-test") >= 0;
        if (smoke && !preview) { MessageBox.Show("自检必须使用 --preview 隔离数据。"); return; }
        int port;
        if (!Int32.TryParse(preview ? "8790" : Environment.GetEnvironmentVariable("PORT") ?? "8787", out port) || port < 1024 || port > 65535)
        { MessageBox.Show("PORT 必须是 1024–65535 内的端口。", "QdiiHelp"); return; }
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string identity;
        using (var sha = SHA256.Create()) identity = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant() + ":" + port))).Replace("-", "").Substring(0, 16);
        bool created;
        using (var mutex = new Mutex(true, "Local\\QdiiHelp-" + identity, out created))
        using (var activate = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\QdiiHelp-open-" + identity))
        {
            if (!created) { activate.Set(); return; }
            try { Application.Run(new TrayContext(root, port, identity, activate, preview, smoke, Array.IndexOf(args, "--startup") >= 0, preview && Array.IndexOf(args,"--show-menu") >= 0)); }
            catch (Exception e) { if(smoke)File.WriteAllText(Path.Combine(root,"tray-smoke-result.txt"),"FAIL: "+e.ToString()); else MessageBox.Show(e.Message, "QdiiHelp 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { mutex.ReleaseMutex(); }
        }
    }
}

internal sealed class TrayContext : ApplicationContext
{
    readonly string root, url, logFile, runName;
    readonly int port;
    readonly bool preview, smoke, showMenu;
    readonly EventWaitHandle activate;
    readonly Control dispatch = new Control();
    readonly NotifyIcon tray;
    readonly Icon icon;
    readonly ToolStripMenuItem status, restart, stop, startup, refresh;
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly object logLock = new object();
    Process child;
    bool ready, stopping, restartPending, quitPending, launching, external, openRequested, refreshing;
    string refreshId;
    int retries, smokeStarts, smokeRefreshes;
    DateTime retryAt = DateTime.MaxValue, readyAt, smokeDeadline;

    public TrayContext(string root, int port, string identity, EventWaitHandle activate, bool preview, bool smoke, bool startupLaunch, bool showMenu)
    {
        this.root=root; this.port=port; this.activate=activate; this.preview=preview; this.smoke=smoke; this.showMenu=showMenu;
        url="http://127.0.0.1:"+port+"/";
        runName="QdiiHelp-"+identity;
        string logDir=preview?Path.Combine(root,"tray-test-logs",identity):Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QdiiHelp", identity);
        Directory.CreateDirectory(logDir); logFile=Path.Combine(logDir,"tray.log");
        var handle=dispatch.Handle;
        icon=MakeIcon();
        var menu=new ContextMenuStrip();
        status=new ToolStripMenuItem("正在启动…"); status.Enabled=false; menu.Items.Add(status);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("打开 QdiiHelp",null,(s,e)=>OpenPage());
        refresh=new ToolStripMenuItem("刷新数据",null,(s,e)=>RefreshData()); refresh.Enabled=false;menu.Items.Add(refresh);
        restart=new ToolStripMenuItem("重启程序",null,(s,e)=>Restart()); menu.Items.Add(restart);
        stop=new ToolStripMenuItem("停止后台",null,(s,e)=>RequestStop(false,false)); menu.Items.Add(stop);
        menu.Items.Add("打开项目目录",null,(s,e)=>Shell(root));
        menu.Items.Add("查看运行日志",null,(s,e)=>Shell(logFile));
        startup=new ToolStripMenuItem("开机启动（登录后）",null,(s,e)=>ToggleStartup());
        startup.Enabled=!preview; RefreshStartup(); menu.Items.Add(startup);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("关于 QdiiHelp",null,(s,e)=>MessageBox.Show("QdiiHelp 托盘版 1.1\n地址："+url+"\n项目："+root+"\n退出时会保存数据并关闭本程序启动的后台。", "QdiiHelp"));
        menu.Items.Add("退出",null,(s,e)=>RequestStop(false,true));
        tray=new NotifyIcon { Icon=icon, Text="QdiiHelp · 正在启动", ContextMenuStrip=menu, Visible=true };
        tray.DoubleClick+=(s,e)=>OpenPage();
        menu.Opening+=(s,e)=>RefreshStartup();
        openRequested=!startupLaunch&&!preview;
        timer.Interval=1000; timer.Tick+=(s,e)=>Tick(); timer.Start();
        smokeDeadline=DateTime.UtcNow.AddSeconds(60);
        Log("托盘启动，项目="+root+"，端口="+port);
        StartBackend();
    }

    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr hIcon);
    static Icon MakeIcon()
    {
        var file=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"tray","QdiiHelp.ico");
        if(File.Exists(file))return new Icon(file, SystemInformation.SmallIconSize);
        using(var bitmap=new Bitmap(32,32))
        {
            using(var graphics=Graphics.FromImage(bitmap))
            using(var background=new SolidBrush(Color.FromArgb(48,91,151)))
            using(var font=new Font("Segoe UI",20,FontStyle.Bold,GraphicsUnit.Pixel))
            {
                graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                graphics.FillEllipse(background,0,0,31,31);
                graphics.DrawString("Q",font,Brushes.White,5,2);
            }
            IntPtr raw=bitmap.GetHicon();
            try { return (Icon)Icon.FromHandle(raw).Clone(); } finally { DestroyIcon(raw); }
        }
    }
    void Post(Action action)
    {
        if(dispatch.IsDisposed)return;
        try { dispatch.BeginInvoke(action); } catch(InvalidOperationException) { }
    }
    void Log(string message)
    {
        lock(logLock)
        {
            try
            {
                if(File.Exists(logFile)&&new FileInfo(logFile).Length>1024*1024)
                { if(File.Exists(logFile+".1"))File.Delete(logFile+".1"); File.Move(logFile,logFile+".1"); }
                File.AppendAllText(logFile,DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")+" "+message+Environment.NewLine,Encoding.UTF8);
            } catch { }
        }
    }
    void SetStatus(string text)
    {
        status.Text=text;
        tray.Text=("QdiiHelp · "+text).Substring(0,Math.Min(63,("QdiiHelp · "+text).Length));
        restart.Enabled=!launching&&!stopping;
        stop.Enabled=child!=null&&!stopping&&!launching;
        refresh.Enabled=ready&&child!=null&&!stopping&&!launching&&!refreshing;
    }
    void Notify(string text,ToolTipIcon notificationIcon=ToolTipIcon.Info)
    {
        Log(text);
        if(!smoke)tray.ShowBalloonTip(5000,"QdiiHelp",text,notificationIcon);
        else Log("自检通知："+notificationIcon+" "+text);
    }
    void Shell(string target)
    {
        try { Process.Start(new ProcessStartInfo(target){UseShellExecute=true}); }
        catch(Exception e){Notify("无法打开："+e.Message);}
    }
    void OpenPage()
    {
        if(ready||external)Shell(url);
        else { openRequested=true; if(child==null&&!launching&&!stopping){retries=0;StartBackend();} else Notify("正在启动或等待任务完成，请稍候。"); }
    }
    string NodePath()
    {
        var paths=new List<string>();
        paths.Add(Path.Combine(root,"runtime","node.exe"));
        paths.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"nodejs","node.exe"));
        foreach(string item in (Environment.GetEnvironmentVariable("PATH")??"").Split(';'))
            if(!String.IsNullOrWhiteSpace(item))paths.Add(Path.Combine(item.Trim().Trim('"'),"node.exe"));
        foreach(string path in paths)if(File.Exists(path))return path;
        throw new FileNotFoundException("未找到 Node.js，请安装 Node.js 22 或以上版本。");
    }
    async void StartBackend()
    {
        if(launching||child!=null||quitPending)return;
        launching=true; external=false; retryAt=DateTime.MaxValue; SetStatus("正在检查启动环境…");
        try
        {
            if(!File.Exists(Path.Combine(root,"tray","managed-entry.mjs")))throw new FileNotFoundException("缺少项目文件，请将 QdiiHelp.exe 保留在项目根目录。");
            using(var http=new HttpClient())
            {
                http.Timeout=TimeSpan.FromSeconds(2);
                try
                {
                    string body=await http.GetStringAsync(url+"api/health");
                    var info=json.Deserialize<Dictionary<string,object>>(body);
                    if(info.ContainsKey("app")&&Convert.ToString(info["app"])=="qdii-help")
                    {
                        if(quitPending)return;
                        external=true; SetStatus("已有独立实例运行");
                        Notify("检测到已有 QdiiHelp。请先关闭原来的黑窗口，再从托盘选择重启程序启动托管实例。");
                        if(openRequested){openRequested=false;Shell(url);} return;
                    }
                } catch(HttpRequestException) { } catch(TaskCanceledException) { } catch(ArgumentException) { }
            }
            if(quitPending)return;
            var process=new Process();
            process.StartInfo=new ProcessStartInfo(NodePath(),"\""+Path.Combine(root,"tray","managed-entry.mjs")+"\"") {
                WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true,
                RedirectStandardInput=true, RedirectStandardOutput=true, RedirectStandardError=true,
                StandardOutputEncoding=Encoding.UTF8, StandardErrorEncoding=Encoding.UTF8
            };
            process.StartInfo.EnvironmentVariables["PORT"]=port.ToString();
            process.StartInfo.EnvironmentVariables["QDII_NO_BROWSER"]="1";
            // Production never inherits a developer's temporary JSON/fixture configuration.
            process.StartInfo.EnvironmentVariables.Remove("QDII_DATA_FILE");
            process.StartInfo.EnvironmentVariables.Remove("QDII_TRAY_FIXTURE");
            process.StartInfo.EnvironmentVariables["QDII_STORAGE"]="postgres";
            if(preview){process.StartInfo.EnvironmentVariables["QDII_TRAY_FIXTURE"]="1";process.StartInfo.EnvironmentVariables["QDII_PREVIEW_PORT"]=port.ToString();}
            process.OutputDataReceived+=(s,e)=>{if(e.Data!=null)ReadOutput(process,e.Data);};
            process.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)Log("后台错误："+e.Data);};
            process.EnableRaisingEvents=true; process.Exited+=(s,e)=>Post(()=>Exited(process));
            child=process;
            try { process.Start();process.BeginOutputReadLine();process.BeginErrorReadLine(); }
            catch { child=null;process.Dispose();throw; }
            SetStatus("正在启动后台…");
        }
        catch(Exception e){Log(e.ToString());ScheduleRetry(e.Message);}
        finally { launching=false; SetStatus(status.Text); if(quitPending&&child==null)ExitThread(); }
    }
    void ReadOutput(Process process,string line)
    {
        Log(line);
        if(!line.StartsWith("QDII_CONTROL "))return;
        try
        {
            var data=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(line.Substring(13));
            Post(()=>{
                if(child!=process)return;
                string type=Convert.ToString(data["type"]);
                if(type=="ready")
                {
                    ready=true;readyAt=DateTime.UtcNow;SetStatus("运行中");
                    if(showMenu)tray.ContextMenuStrip.Show(new Point(Screen.PrimaryScreen.WorkingArea.Right-260,Screen.PrimaryScreen.WorkingArea.Bottom-380));
                    if(openRequested){openRequested=false;Shell(url);}
                    if(smoke){smokeStarts++;if(smokeStarts==1){if(!refresh.Enabled)throw new Exception("刷新菜单未启用");refresh.PerformClick();}else RequestStop(false,true);}
                }
                else if(type=="status"&&!stopping&&!refreshing)SetStatus(Convert.ToBoolean(data["busy"])?"运行中 · 正在处理数据":"运行中 · 空闲");
                else if(type=="refresh-started"&&Convert.ToString(data["id"])==refreshId){refreshing=true;refresh.Text="正在刷新数据…";if(!stopping)SetStatus("运行中 · 正在刷新数据");}
                else if(type=="refresh-progress"&&Convert.ToString(data["id"])==refreshId&&!stopping)SetStatus("正在刷新 · "+Convert.ToString(data["completed"])+" / "+Convert.ToString(data["total"]));
                else if(type=="refresh-result"&&Convert.ToString(data["id"])==refreshId){
                    refreshing=false;refreshId=null;refresh.Text="刷新数据";
                    bool ok=Convert.ToBoolean(data["ok"]),warning=data.ContainsKey("warning")&&Convert.ToBoolean(data["warning"]);
                    Notify(Convert.ToString(data["message"]),!ok?ToolTipIcon.Error:warning?ToolTipIcon.Warning:ToolTipIcon.Info);
                    if(!stopping)SetStatus("运行中 · 空闲");
                    if(smoke){if(ok){smokeRefreshes++;Restart();}else{File.WriteAllText(Path.Combine(root,"tray-smoke-result.txt"),"FAIL: refresh failed");RequestStop(false,true);}}
                }
                else if(type=="stopping")SetStatus("正在保存并等待任务结束…");
                else if(type=="error") { Notify(Convert.ToString(data["message"])); if(stopping&&data.ContainsKey("phase")&&Convert.ToString(data["phase"])=="shutdown"){stopping=false;restartPending=false;quitPending=false;SetStatus("关闭失败 · 请查看日志");} }
            });
        }
        catch(Exception e){Log("控制消息解析失败："+e.Message);}
    }
    void ScheduleRetry(string reason)
    {
        ready=false;retries++;
        if(retries<=3){retryAt=DateTime.UtcNow.AddSeconds(15);SetStatus("启动失败 · 15秒后重试（"+retries+"/3）");}
        else {retryAt=DateTime.MaxValue;SetStatus("后台已停止 · 启动失败");Notify(reason+"；请查看日志，排除问题后选择重启程序。");}
    }
    void Exited(Process process)
    {
        if(child!=process)return;
        int code=process.ExitCode;
        bool wasReady=ready;
        Log("后台退出 PID="+process.Id+" code="+code);
        child=null;ready=false;process.Dispose();
        if(refreshing){refreshing=false;refreshId=null;refresh.Text="刷新数据";Notify("刷新未完成：后台已经退出，请重新启动后检查保存的结果。",ToolTipIcon.Warning);}
        if(quitPending&&!wasReady&&code!=0){ExitThread();return;}
        if(stopping&&code==0)
        {
            stopping=false;
            if(quitPending){if(smoke)File.WriteAllText(Path.Combine(root,"tray-smoke-result.txt"),smokeStarts==2&&smokeRefreshes==1?"PASS: hidden start, refresh menu, completion notification, graceful restart and exit":"FAIL: unexpected starts or refresh result");ExitThread();return;}
            if(restartPending){restartPending=false;retries=0;StartBackend();return;}
            SetStatus("后台已停止");return;
        }
        stopping=false;restartPending=false;quitPending=false;
        if(readyAt!=default(DateTime)&&DateTime.UtcNow-readyAt>TimeSpan.FromMinutes(1))retries=0;
        ScheduleRetry("后台异常退出（"+code+"）");
    }
    void Restart()
    {
        if(external){external=false;retries=0;StartBackend();return;}
        if(child==null){retries=0;StartBackend();return;}
        RequestStop(true,false);
    }
    void RefreshData()
    {
        if(!ready||child==null||stopping||launching||refreshing)return;
        refreshing=true;refreshId=Guid.NewGuid().ToString("N");refresh.Text="正在刷新数据…";SetStatus("运行中 · 正在刷新数据");
        try{child.StandardInput.WriteLine("{\"command\":\"refresh\",\"id\":\""+refreshId+"\"}");child.StandardInput.Flush();}
        catch(Exception e){refreshing=false;refreshId=null;refresh.Text="刷新数据";SetStatus("刷新失败");Notify("无法开始刷新："+e.Message,ToolTipIcon.Error);}
    }
    void RequestStop(bool restartAfter,bool quitAfter)
    {
        retryAt=DateTime.MaxValue;
        if(stopping){if(quitAfter){quitPending=true;restartPending=false;}return;}
        if(child==null){if(quitAfter){quitPending=true;if(!launching)ExitThread();}else SetStatus("后台已停止");return;}
        stopping=true;restartPending=restartAfter;quitPending=quitAfter;
        SetStatus("正在保存并等待任务结束…");
        try {child.StandardInput.WriteLine("{\"command\":\"stop\"}");child.StandardInput.Flush();}
        catch(Exception e){stopping=false;restartPending=false;quitPending=false;Notify("无法通知后台关闭："+e.Message);SetStatus("关闭失败 · 请查看日志");}
    }
    void RefreshStartup()
    {
        try {using(var key=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run"))startup.Checked=key!=null&&Convert.ToString(key.GetValue(runName))=="\""+Application.ExecutablePath+"\" --startup";}
        catch {startup.Checked=false;}
    }
    void ToggleStartup()
    {
        try
        {
            using(var key=Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run"))
            {if(startup.Checked)key.DeleteValue(runName,false);else key.SetValue(runName,"\""+Application.ExecutablePath+"\" --startup");}
            RefreshStartup();Notify(startup.Checked?"已启用登录后启动。":"已关闭开机启动。");
        }catch(Exception e){Notify("开机启动设置失败："+e.Message);}
    }
    void Tick()
    {
        if(showMenu&&ready&&!stopping&&!tray.ContextMenuStrip.Visible)tray.ContextMenuStrip.Show(new Point(Screen.PrimaryScreen.WorkingArea.Right-260,Screen.PrimaryScreen.WorkingArea.Bottom-380));
        if(activate.WaitOne(0))OpenPage();
        if(child==null&&!launching&&!stopping&&!quitPending&&DateTime.UtcNow>=retryAt)StartBackend();
        if(smoke&&DateTime.UtcNow>=smokeDeadline)
        {
            File.WriteAllText(Path.Combine(root,"tray-smoke-result.txt"),"FAIL: timed out; "+status.Text);
            if(child!=null&&!child.HasExited)child.Kill();
            ExitThread();
        }
    }
    protected override void ExitThreadCore()
    {
        timer.Stop();timer.Dispose();tray.Visible=false;tray.Dispose();icon.Dispose();dispatch.Dispose();
        base.ExitThreadCore();
    }
}
