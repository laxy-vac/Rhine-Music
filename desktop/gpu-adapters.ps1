$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

try {
  Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using Microsoft.Win32;
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
    public ulong dedicatedMemoryBytes { get; set; }
    public string[] physicalKeys { get; set; }
    public string[] physicalLocations { get; set; }
    public string pciAddress { get; set; }
    public string identityError { get; set; }
}

public static class RhineGpuAdapterEnumerator
{
    private const uint DxgiAdapterFlagSoftware = 2;
    private const uint D3d11SdkVersion = 7;
    private const int DxgiErrorNotFound = unchecked((int)0x887A0002);
    private const int KmtQaiTypeAdapterAddress = 6;
    private const int KmtQaiTypePhysicalAdapterCount = 30;
    private const int KmtQaiTypePhysicalAdapterPnpKey = 41;
    private const int D3dkmtPnpKeyHardware = 1;
    private const int StatusBufferOverflow = unchecked((int)0x80000005);
    private const int StatusBufferTooSmall = unchecked((int)0xC0000023);
    private const uint MaxPhysicalAdapterCount = 16;
    private const uint InitialPnpKeyCapacity = 4096;
    private const uint MaxPnpKeyCapacity = 32768;
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

    // D3DKMT layouts and enum values follow the Windows SDK header:
    // https://raw.githubusercontent.com/microsoft/win32metadata/main/generation/WinSDK/RecompiledIdlHeaders/shared/d3dkmthk.h
    [StructLayout(LayoutKind.Sequential)]
    private struct D3dkmtOpenAdapterFromLuid
    {
        public Luid AdapterLuid;
        public uint hAdapter;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3dkmtCloseAdapter
    {
        public uint hAdapter;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3dkmtQueryAdapterInfo
    {
        public uint hAdapter;
        public int Type;
        public IntPtr pPrivateDriverData;
        public uint PrivateDriverDataSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3dkmtPhysicalAdapterCount
    {
        public uint Count;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3dkmtAdapterAddress
    {
        public uint BusNumber;
        public uint DeviceNumber;
        public uint FunctionNumber;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3dkmtQueryPhysicalAdapterPnpKey
    {
        public uint PhysicalAdapterIndex;
        public int PnPKeyType;
        public IntPtr pDest;
        public IntPtr pCchDest;
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

    [DllImport("gdi32.dll", EntryPoint = "D3DKMTOpenAdapterFromLuid", ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    private static extern int D3DKMTOpenAdapterFromLuid(ref D3dkmtOpenAdapterFromLuid data);

    [DllImport("gdi32.dll", EntryPoint = "D3DKMTQueryAdapterInfo", ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    private static extern int D3DKMTQueryAdapterInfo(ref D3dkmtQueryAdapterInfo data);

    [DllImport("gdi32.dll", EntryPoint = "D3DKMTCloseAdapter", ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    private static extern int D3DKMTCloseAdapter(ref D3dkmtCloseAdapter data);

    [StructLayout(LayoutKind.Sequential)]
    private struct DeviceInfoData
    {
        public uint Size;
        public Guid ClassGuid;
        public uint DevInst;
        public UIntPtr Reserved;
    }

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern IntPtr SetupDiCreateDeviceInfoList(IntPtr classGuid, IntPtr parent);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupDiOpenDeviceInfoW(IntPtr list, string instanceId, IntPtr parent, uint flags, ref DeviceInfoData info);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupDiGetDeviceRegistryPropertyW(IntPtr list, ref DeviceInfoData info, uint property, out uint type, byte[] data, uint size, out uint required);

    [DllImport("setupapi.dll")]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr list);

    private static bool ReadDeviceDword(IntPtr list, ref DeviceInfoData info, uint property, out uint value)
    {
        uint type, required;
        byte[] buffer = new byte[4];
        value = 0;
        if (!SetupDiGetDeviceRegistryPropertyW(list, ref info, property, out type, buffer, 4, out required) || type != 4 || required != 4) return false;
        value = BitConverter.ToUInt32(buffer, 0);
        return true;
    }

    private static string ReadPhysicalPciLocation(string instanceId)
    {
        IntPtr list = SetupDiCreateDeviceInfoList(IntPtr.Zero, IntPtr.Zero);
        if (list == IntPtr.Zero || list == new IntPtr(-1)) return String.Empty;
        try
        {
            var info = new DeviceInfoData { Size = (uint)Marshal.SizeOf(typeof(DeviceInfoData)) };
            if (!SetupDiOpenDeviceInfoW(list, instanceId, IntPtr.Zero, 0, ref info)) return String.Empty;
            uint bus, address;
            // SDK SetupAPI.h: SPDRP_BUSNUMBER=0x15, SPDRP_ADDRESS=0x1c.
            // PCI address encodes the device in its high word and function in its low word.
            if (!ReadDeviceDword(list, ref info, 0x15, out bus) || !ReadDeviceDword(list, ref info, 0x1c, out address)) return String.Empty;
            uint device = address >> 16, function = address & 0xffff;
            if (bus > 255 || device > 31 || function > 7) return String.Empty;
            return String.Format(System.Globalization.CultureInfo.InvariantCulture, "PCI {0}:{1}.{2}", bus, device, function);
        }
        finally { SetupDiDestroyDeviceInfoList(list); }
    }

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

    private static int QueryAdapterInfo(uint adapterHandle, int type, IntPtr data, uint dataSize)
    {
        var query = new D3dkmtQueryAdapterInfo
        {
            hAdapter = adapterHandle,
            Type = type,
            pPrivateDriverData = data,
            PrivateDriverDataSize = dataSize
        };
        return D3DKMTQueryAdapterInfo(ref query);
    }

    private static string NtStatusText(int status)
    {
        return "NTSTATUS 0x" + unchecked((uint)status).ToString("X8");
    }

    private static string QueryPciAddress(uint adapterHandle)
    {
        IntPtr data = IntPtr.Zero;
        try
        {
            int size = Marshal.SizeOf(typeof(D3dkmtAdapterAddress));
            data = Marshal.AllocHGlobal(size);
            Marshal.StructureToPtr(new D3dkmtAdapterAddress(), data, false);
            int status = QueryAdapterInfo(adapterHandle, KmtQaiTypeAdapterAddress, data, (uint)size);
            if (status < 0) return String.Empty;
            var address = (D3dkmtAdapterAddress)Marshal.PtrToStructure(data, typeof(D3dkmtAdapterAddress));
            if (address.BusNumber > 255 || address.DeviceNumber > 31 || address.FunctionNumber > 7)
                return String.Empty;
            return String.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "PCI {0}:{1}.{2}",
                address.BusNumber,
                address.DeviceNumber,
                address.FunctionNumber);
        }
        catch
        {
            return String.Empty;
        }
        finally
        {
            if (data != IntPtr.Zero) Marshal.FreeHGlobal(data);
        }
    }

    private static string ReadPhysicalLocation(string hardwarePnpKey)
    {
        const string registryMachinePrefix = "\\REGISTRY\\MACHINE\\";
        const string deviceParametersSuffix = "\\Device Parameters";
        try
        {
            if (String.IsNullOrEmpty(hardwarePnpKey) ||
                !hardwarePnpKey.StartsWith(registryMachinePrefix, StringComparison.OrdinalIgnoreCase))
                return String.Empty;

            string registryPath = hardwarePnpKey.Substring(registryMachinePrefix.Length);
            if (registryPath.EndsWith(deviceParametersSuffix, StringComparison.OrdinalIgnoreCase))
                registryPath = registryPath.Substring(0, registryPath.Length - deviceParametersSuffix.Length);

            string[] parts = registryPath.Split('\\');
            if (parts.Length != 6 ||
                !String.Equals(parts[0], "SYSTEM", StringComparison.OrdinalIgnoreCase) ||
                !System.Text.RegularExpressions.Regex.IsMatch(
                    parts[1],
                    @"^ControlSet[0-9]{3}$",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant) ||
                !String.Equals(parts[2], "Enum", StringComparison.OrdinalIgnoreCase))
                return String.Empty;

            for (int index = 0; index < parts.Length; index++)
            {
                if (String.IsNullOrEmpty(parts[index]) || parts[index] == "." || parts[index] == "..")
                    return String.Empty;
                if (parts[index].IndexOfAny(new[] { '/', ':', '\0' }) >= 0)
                    return String.Empty;
            }

            if (String.Equals(parts[3], "PCI", StringComparison.OrdinalIgnoreCase))
            {
                string location = ReadPhysicalPciLocation(String.Join("\\", new[] { parts[3], parts[4], parts[5] }));
                if (!String.IsNullOrEmpty(location)) return location;
            }

            using (RegistryKey key = Registry.LocalMachine.OpenSubKey(registryPath, false))
            {
                if (key == null) return String.Empty;

                object locationInformation = key.GetValue("LocationInformation", null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                string location = locationInformation as string;
                if (!String.IsNullOrWhiteSpace(location) && !location.StartsWith("@", StringComparison.Ordinal)) return location.Trim();

                object locationPaths = key.GetValue("LocationPaths", null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                string[] paths = locationPaths as string[];
                if (paths != null && paths.Length > 0 && !String.IsNullOrWhiteSpace(paths[0]))
                    return paths[0].Trim();
            }
        }
        catch
        {
            // Location metadata is optional; preserve the authoritative PnP key if unavailable.
        }
        return String.Empty;
    }

    private static string QueryPhysicalAdapterPnpKey(uint adapterHandle, uint physicalAdapterIndex)
    {
        uint capacity = InitialPnpKeyCapacity;
        while (capacity <= MaxPnpKeyCapacity)
        {
            IntPtr destination = IntPtr.Zero;
            IntPtr destinationLength = IntPtr.Zero;
            IntPtr queryData = IntPtr.Zero;
            try
            {
                int queryDataSize = Marshal.SizeOf(typeof(D3dkmtQueryPhysicalAdapterPnpKey));
                destination = Marshal.AllocHGlobal(checked((int)capacity * 2));
                destinationLength = Marshal.AllocHGlobal(sizeof(uint));
                queryData = Marshal.AllocHGlobal(queryDataSize);
                Marshal.WriteInt32(destinationLength, unchecked((int)capacity));

                var pnpKey = new D3dkmtQueryPhysicalAdapterPnpKey
                {
                    PhysicalAdapterIndex = physicalAdapterIndex,
                    PnPKeyType = D3dkmtPnpKeyHardware,
                    pDest = destination,
                    pCchDest = destinationLength
                };
                Marshal.StructureToPtr(pnpKey, queryData, false);

                int status = QueryAdapterInfo(
                    adapterHandle,
                    KmtQaiTypePhysicalAdapterPnpKey,
                    queryData,
                    (uint)queryDataSize);
                uint written = unchecked((uint)Marshal.ReadInt32(destinationLength));
                if (status >= 0 && written > 0 && written <= capacity)
                {
                    string key = Marshal.PtrToStringUni(destination, (int)written).TrimEnd('\0');
                    if (key.Length == 0)
                        throw new InvalidOperationException("D3DKMT returned an empty hardware PnP key.");
                    return key;
                }

                bool tooSmall = status == StatusBufferTooSmall || status == StatusBufferOverflow || written > capacity;
                if (tooSmall && capacity < MaxPnpKeyCapacity)
                {
                    uint nextCapacity = written > capacity ? written : capacity * 2;
                    if (nextCapacity > MaxPnpKeyCapacity)
                        throw new InvalidOperationException("Hardware PnP key exceeds the 32768-character limit.");
                    capacity = nextCapacity;
                    continue;
                }

                if (status < 0)
                    throw new InvalidOperationException("D3DKMTQueryAdapterInfo(PHYSICALADAPTERPNPKEY) failed with " + NtStatusText(status) + ".");
                throw new InvalidOperationException("D3DKMT returned an invalid hardware PnP key length.");
            }
            finally
            {
                if (queryData != IntPtr.Zero) Marshal.FreeHGlobal(queryData);
                if (destinationLength != IntPtr.Zero) Marshal.FreeHGlobal(destinationLength);
                if (destination != IntPtr.Zero) Marshal.FreeHGlobal(destination);
            }
        }
        throw new InvalidOperationException("Hardware PnP key exceeds the 32768-character limit.");
    }

    private static void ReadPhysicalIdentity(RhineGpuAdapterInfo adapter)
    {
        adapter.physicalKeys = new string[0];
        adapter.physicalLocations = new string[0];
        adapter.pciAddress = String.Empty;
        adapter.identityError = null;

        IntPtr countData = IntPtr.Zero;
        uint adapterHandle = 0;
        bool opened = false;
        try
        {
            var open = new D3dkmtOpenAdapterFromLuid
            {
                AdapterLuid = new Luid { LowPart = adapter.luidLow, HighPart = adapter.luidHigh }
            };
            int status = D3DKMTOpenAdapterFromLuid(ref open);
            if (status < 0)
            {
                adapter.identityError = "D3DKMTOpenAdapterFromLuid failed with " + NtStatusText(status) + ".";
                return;
            }
            adapterHandle = open.hAdapter;
            opened = true;

            int countSize = Marshal.SizeOf(typeof(D3dkmtPhysicalAdapterCount));
            countData = Marshal.AllocHGlobal(countSize);
            Marshal.StructureToPtr(new D3dkmtPhysicalAdapterCount(), countData, false);
            status = QueryAdapterInfo(adapterHandle, KmtQaiTypePhysicalAdapterCount, countData, (uint)countSize);
            if (status < 0)
            {
                adapter.identityError = "D3DKMTQueryAdapterInfo(PHYSICALADAPTERCOUNT) failed with " + NtStatusText(status) + ".";
                return;
            }

            var physicalAdapterCount = (D3dkmtPhysicalAdapterCount)Marshal.PtrToStructure(
                countData,
                typeof(D3dkmtPhysicalAdapterCount));
            if (physicalAdapterCount.Count == 0 || physicalAdapterCount.Count > MaxPhysicalAdapterCount)
            {
                adapter.identityError = "D3DKMT returned an invalid physical adapter count (" + physicalAdapterCount.Count + ").";
                return;
            }

            if (physicalAdapterCount.Count == 1)
                adapter.pciAddress = QueryPciAddress(adapterHandle);

            var physicalKeys = new List<string>();
            var physicalLocations = new List<string>();
            for (uint physicalIndex = 0; physicalIndex < physicalAdapterCount.Count; physicalIndex++)
            {
                string physicalKey = QueryPhysicalAdapterPnpKey(adapterHandle, physicalIndex);
                physicalKeys.Add(physicalKey);
                physicalLocations.Add(ReadPhysicalLocation(physicalKey));
            }
            adapter.physicalKeys = physicalKeys.ToArray();
            adapter.physicalLocations = physicalLocations.ToArray();
        }
        catch (Exception error)
        {
            adapter.physicalKeys = new string[0];
            adapter.physicalLocations = new string[0];
            adapter.identityError = "Physical adapter identity query failed: " + error.GetType().Name + ": " + error.Message;
        }
        finally
        {
            if (countData != IntPtr.Zero) Marshal.FreeHGlobal(countData);
            if (opened)
            {
                try
                {
                    var close = new D3dkmtCloseAdapter { hAdapter = adapterHandle };
                    int closeStatus = D3DKMTCloseAdapter(ref close);
                    if (closeStatus < 0 && String.IsNullOrEmpty(adapter.identityError))
                        adapter.identityError = "D3DKMTCloseAdapter failed with " + NtStatusText(closeStatus) + ".";
                }
                catch (Exception error)
                {
                    if (String.IsNullOrEmpty(adapter.identityError))
                        adapter.identityError = "D3DKMTCloseAdapter failed: " + error.GetType().Name + ": " + error.Message;
                }
            }
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
                    var adapterInfo = new RhineGpuAdapterInfo
                    {
                        name = name,
                        vendorId = description.VendorId,
                        deviceId = description.DeviceId,
                        subSysId = description.SubSysId,
                        revision = description.Revision,
                        luidHigh = description.AdapterLuid.HighPart,
                        luidLow = description.AdapterLuid.LowPart,
                        dedicatedMemoryBytes = description.DedicatedVideoMemory.ToUInt64(),
                        physicalKeys = new string[0],
                        physicalLocations = new string[0],
                        pciAddress = String.Empty,
                        identityError = null
                    };
                    ReadPhysicalIdentity(adapterInfo);
                    adapters.Add(adapterInfo);
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
