# X20CTL 网页手柄驱动

这是基于 [Amjad AAYD 的 X20CTL](https://github.com/AmjadAAYD/x20ctl) 修改的网页版，修改日期为 **2026-11-22**。网页版移植了 KeyLinker 蓝牙配置协议，重做了中文界面，并加入浏览器手柄测试和 Windows XInput 读取。

原项目版权为 © 2026 Amjad AAYD。此修改版按 **GPL-3.0-or-later** 发布，可依照该许可证复制、修改和再分发。软件按现状提供，详见 [许可证全文](../LICENSE)、[原作者声明](../NOTICE) 和 [第三方许可证](../THIRD_PARTY.md)。

## 启动

Windows 上可以双击 `start-web.cmd`。也可以在原项目根目录运行以下命令。启动器使用 Node.js 22，无需安装项目依赖。

```powershell
node web/serve.mjs
```

在桌面版 Chrome 或 Edge 的独立标签页打开 [本机驱动](http://localhost:8765/)。保持启动终端运行，打开系统蓝牙并点「连接手柄」，在浏览器列出的设备中选择手柄的低功耗蓝牙配置接口。原版 X20 可能以 `Xpert2` 显示。若找不到设备，关闭手机上的 KeyLinker 或其他配置软件，再到「连接诊断」试用「扩大蓝牙搜索」。网页蓝牙需要 HTTPS 或本机安全上下文。访问其他机器上的普通 HTTP 地址时无法使用网页蓝牙。 [Chrome Web Bluetooth 文档](https://developer.chrome.com/docs/capabilities/bluetooth)

连接后进入设置页，网页会自动读取手柄当前值。修改后点「写入手柄」，读回值匹配时会显示成功。页面右上方的「待写入」可以查看不同设置页的草稿并直接返回。概览里的「体验演示」使用内存中的模拟手柄，可以体验同一套读写流程。

「按键与背键」会读取当前选中的映射或背键。点手柄正面上的按键，再选输出。切到「背键宏」并点 M 键，可添加组合动作和停顿，或调整步骤顺序。切换正面和背面时会保留草稿，写入按钮显示本次要保存的范围。

## 板载配置范围

| 原项目实测身份 | 实测固件与模式 |
| --- | --- |
| EasySMX X20 `1013:2009` | 固件 `1.23`、工作模式 `2` |
| EasySMX X20 Pro `1020:2006` | 固件 `1.44`、工作模式 `6` |

已识别机型的设置按手柄回报的能力开放。固件版本和工作模式用于识别协议格式。网页读取并核对记录格式后，允许试写按键映射、摇杆和扳机曲线、振动与电源、背键宏或 X20 Pro 灯效。每次写入均需读回匹配。未知机型显示身份。

「振动与电源」页的「试写振动并恢复」会临时调整左握把振动，读取核对后写回原始记录，再次读回确认恢复。X20 的选择键和开始键只作为映射目标。电量沿用协议的四档读数。

打开「输入测试」后会自动检测手柄，并显示当前输入来源。网页优先读取浏览器的 Gamepad API。Windows 上如果浏览器没有提供手柄输入，本机服务可以通过 PATH 中的 Python 读取 XInput。切出测试页或暂停时会停止读取。手柄需通过数据线、接收器或游戏蓝牙模式向电脑发送游戏输入。

桌面版中的虚拟手柄 PC 模式、USB 小屏上传、独立分区灯效、系统集成以及未移植的板载功能需使用原桌面版。网页通过本机 BLE 与手柄通信，启动器仅提供网页文件。

## 协议验证

```powershell
node --test web/protocol.test.mjs web/input-bridge.test.mjs
```

测试覆盖上游 X20 实测报文、CRC、应答序号关联、两款手柄的分包和宏格式、X20 Pro 1.31 模式 2 的常规写入、振动试写与恢复，以及断连或无有效应答时的处理。

## USB 与接收器实验

在实验分支运行 `node web/serve.mjs 8766`，打开 [接口探测页](http://localhost:8766/web/transport.html)。依次只接数据线和只接接收器，每次选中对应连接方式，再检查 HID 和 USB。报告可复制，按连接方式分别保存本次页面会话中的最新结果。WebHID 显示报告 ID 和厂商用途页，WebUSB 显示接口类别及端点。探测只调用浏览器选择器并读取描述符，未打开端点、串口或发送设备命令。

| 接口 | 已知用途与证据 |
| --- | --- |
| X20 有线和 2.4 GHz | 原项目实测了几种模式的游戏 HID 接口，当时未发现板载配置通道。`045E:028E` 和 `0079:181C` 是共享标识，无法单靠 ID 区分型号或连接方式。 |
| X20 Pro 接收器 `413D:2131` | 原项目在零售版记录了 `FF70` 和 `FF10` 厂商 HID 集合。该 ID 也用于 Dune 8K，集合存在只能作为研究线索。已知原版工作流为接收器传输游戏输入，单独的 BLE 连接负责同步设置。 |
| X20 Pro USB 串口 `EEEF:268A` | 原版用于上传 160×80 小屏素材。按住 M 键插入数据线后，可用「检查小屏串口」查看浏览器是否能选择它。 |

WebHID 或 WebUSB 没有列出设备时，可以在同一连接方式下用原项目的 Windows 只读扫描器 `python tools/hid_scan.py --vid 413D` 核对接收器的 HID 集合。对有线的常见 XInput 接口可使用 `--vid 045E`。接口探测还需要在目标手柄上各跑一次。验证非蓝牙板载配置还需要明确的设备协议和可复现的读回。 [上游传输测试](../docs/01-protocol.md#4g-transports-tested-so-far) · [上游接收器记录](../desktop-dotnet/X20Ctl.Product/Scanner/ScanFlow.cs) · [上游小屏串口](../desktop-dotnet/X20Ctl.Product/ScreenSerialTransport.cs)

```powershell
node --test web/protocol.test.mjs web/usb-probe.test.mjs
```

协议和手柄图片来自 X20CTL 源码快照 `9d64ed1c039964b3e805b9ffbb42d9762995c02e`。参考 [KeyLinker 协议](../docs/01-protocol.md)、[Python 客户端](../x20ctl/client.py) 与 [Windows X20 Pro 客户端](../desktop-dotnet/X20Ctl.Product/LightingBleClient.cs)。沿用项目的 [GPL-3.0-or-later](../LICENSE) 和[原作者声明](../NOTICE)。
