$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

try {
  Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public sealed class RhineGpuAdapterInfo
{
    public string name { get; set; }
    public uint vendorId { get; set; }
    public uint deviceId { get; set; }
    public uint subSysId { get; set; }
    public uint revision { get; set; }
    public int luidHigh { get; set; }
    public uint luidLow { get; set; }
}

public static class RhineGpuAdapterEnumerator
{
    private const uint DxgiAdapterFlagSoftware = 2;
    private const uint D3d11SdkVersion = 7;
    private const int DxgiErrorNotFound = unchecked((int)0x887A0002);
    private static readonly Guid DxgiFactory1Id = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Luid
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DxgiAdapterDesc1
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string Description;
        public uint VendorId;
        public uint DeviceId;
        public uint SubSysId;
        public uint Revision;
        public UIntPtr DedicatedVideoMemory;
        public UIntPtr DedicatedSystemMemory;
        public UIntPtr SharedSystemMemory;
        public Luid AdapterLuid;
        public uint Flags;
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int EnumAdapters1Delegate(IntPtr factory, uint index, out IntPtr adapter);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetDesc1Delegate(IntPtr adapter, out DxgiAdapterDesc1 description);

    [DllImport("dxgi.dll", ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    private static extern int CreateDXGIFactory1(ref Guid interfaceId, out IntPtr factory);

    [DllImport("d3d11.dll", ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    private static extern int D3D11CreateDevice(
        IntPtr adapter,
        int driverType,
        IntPtr software,
        uint flags,
        IntPtr featureLevels,
        uint featureLevelCount,
        uint sdkVersion,
        out IntPtr device,
        out uint featureLevel,
        out IntPtr immediateContext);

    private static IntPtr VtableMethod(IntPtr instance, int index)
    {
        IntPtr vtable = Marshal.ReadIntPtr(instance);
        return Marshal.ReadIntPtr(vtable, index * IntPtr.Size);
    }

    private static void ReleaseComObject(IntPtr value)
    {
        if (value != IntPtr.Zero) Marshal.Release(value);
    }

    private static void ThrowIfFailed(int result, string operation, string adapterName = null)
    {
        if (result >= 0) return;
        string target = String.IsNullOrEmpty(adapterName) ? String.Empty : " for '" + adapterName + "'";
        throw new COMException(operation + target + " failed with HRESULT 0x" + result.ToString("X8"), result);
    }

    private static void ValidateD3d11Device(IntPtr adapter, string adapterName)
    {
        IntPtr device = IntPtr.Zero;
        IntPtr context = IntPtr.Zero;
        uint featureLevel;
        int result = D3D11CreateDevice(
            adapter,
            0, // D3D_DRIVER_TYPE_UNKNOWN is required when an adapter is supplied.
            IntPtr.Zero,
            0,
            IntPtr.Zero,
            0,
            D3d11SdkVersion,
            out device,
            out featureLevel,
            out context);
        try
        {
            ThrowIfFailed(result, "D3D11CreateDevice", adapterName);
            if (device == IntPtr.Zero || context == IntPtr.Zero)
                throw new InvalidOperationException("D3D11CreateDevice returned incomplete interfaces for '" + adapterName + "'.");
        }
        finally
        {
            ReleaseComObject(context);
            ReleaseComObject(device);
        }
    }

    public static RhineGpuAdapterInfo[] Enumerate()
    {
        IntPtr factory = IntPtr.Zero;
        Guid interfaceId = DxgiFactory1Id;
        int result = CreateDXGIFactory1(ref interfaceId, out factory);
        try
        {
            ThrowIfFailed(result, "CreateDXGIFactory1");
            if (factory == IntPtr.Zero) throw new InvalidOperationException("CreateDXGIFactory1 returned a null factory.");

            var enumAdapters1 = (EnumAdapters1Delegate)Marshal.GetDelegateForFunctionPointer(
                VtableMethod(factory, 12), typeof(EnumAdapters1Delegate));
            var adapters = new List<RhineGpuAdapterInfo>();

            // Probe one item past the limit so exactly 32 adapters remain valid.
            for (uint index = 0; index <= 32; index++)
            {
                IntPtr adapter = IntPtr.Zero;
                result = enumAdapters1(factory, index, out adapter);
                if (result == DxgiErrorNotFound)
                {
                    ReleaseComObject(adapter);
                    break;
                }

                try
                {
                    ThrowIfFailed(result, "IDXGIFactory1::EnumAdapters1 at index " + index);
                    if (adapter == IntPtr.Zero)
                        throw new InvalidOperationException("IDXGIFactory1::EnumAdapters1 returned a null adapter at index " + index + ".");
                    if (index == 32)
                        throw new InvalidOperationException("More than 32 DXGI adapters were reported.");

                    var getDesc1 = (GetDesc1Delegate)Marshal.GetDelegateForFunctionPointer(
                        VtableMethod(adapter, 10), typeof(GetDesc1Delegate));
                    DxgiAdapterDesc1 description;
                    result = getDesc1(adapter, out description);
                    ThrowIfFailed(result, "IDXGIAdapter1::GetDesc1 at index " + index);
                    if ((description.Flags & DxgiAdapterFlagSoftware) != 0) continue;

                    string name = (description.Description ?? String.Empty).TrimEnd('\0').Trim();
                    if (name.Length == 0)
                        throw new InvalidOperationException("DXGI adapter at index " + index + " has an empty description.");

                    // A present DXGI adapter without a usable D3D11 device is
                    // not an available renderer (for example, a disabled driver).
                    try { ValidateD3d11Device(adapter, name); }
                    catch (COMException) { continue; }
                    adapters.Add(new RhineGpuAdapterInfo
                    {
                        name = name,
                        vendorId = description.VendorId,
                        deviceId = description.DeviceId,
                        subSysId = description.SubSysId,
                        revision = description.Revision,
                        luidHigh = description.AdapterLuid.HighPart,
                        luidLow = description.AdapterLuid.LowPart
                    });
                }
                finally
                {
                    ReleaseComObject(adapter);
                }
            }

            return adapters.ToArray();
        }
        finally
        {
            ReleaseComObject(factory);
        }
    }
}
'@

  $adapters = [RhineGpuAdapterEnumerator]::Enumerate()
  $json = ConvertTo-Json -InputObject @($adapters) -Depth 3 -Compress
  [Console]::Out.WriteLine($json)
  exit 0
}
catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
}
