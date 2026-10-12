param()
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$dependencyRoot = Join-Path $repoRoot 'out/prototype-deps'
$dependencies = @(
    @{Name='imgui'; Url='https://github.com/ocornut/imgui.git'; Revision='cb16be3a3fc1f9cd146ae24d52b615f8a05fa93d'},
    @{Name='imgui-node-editor'; Url='https://github.com/thedmd/imgui-node-editor.git'; Revision='021aa0ea4da13fed864bafb2a92d4c5205076866'}
)
foreach ($dependency in $dependencies) {
    $destination = Join-Path $dependencyRoot $dependency.Name
    if (-not (Test-Path -LiteralPath $destination)) {
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        & git -C $destination init --quiet
        if ($LASTEXITCODE -ne 0) { throw 'Dependency initialization failed' }
        & git -C $destination remote add origin $dependency.Url
        if ($LASTEXITCODE -ne 0) { throw 'Dependency remote setup failed' }
        & git -C $destination fetch --depth 1 origin $dependency.Revision
        if ($LASTEXITCODE -ne 0) { throw 'Dependency fetch failed' }
        & git -C $destination checkout --detach --quiet FETCH_HEAD
        if ($LASTEXITCODE -ne 0) { throw 'Dependency checkout failed' }
    }
    $actualRevision = & git -C $destination rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $actualRevision -ne $dependency.Revision) {
        throw ('Dependency revision mismatch: ' + $destination + '; preserve it and inspect before rebuilding')
    }
    & git -C $destination diff --quiet HEAD
    if ($LASTEXITCODE -ne 0) { throw ('Dependency has local changes: ' + $destination + '; preserve them before rebuilding') }
}
$vswhere = Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio 2022 with C++ tools and Windows SDK is required' }
$msbuild = & $vswhere -latest -products '*' -version '[17.0,18.0)' -find 'MSBuild/Current/Bin/MSBuild.exe'
if (-not $msbuild) { throw 'Visual Studio 2022 MSBuild was not found' }
& $msbuild (Join-Path $PSScriptRoot 'NodrecUiPrototype.vcxproj') /m /nologo /verbosity:minimal /p:Configuration=Release /p:Platform=x64
if ($LASTEXITCODE -ne 0) { throw 'Prototype build failed' }
$executable = Join-Path $repoRoot 'out/imgui-interaction/NodrecUiPrototype.exe'
$selfCheck = Start-Process -FilePath $executable -ArgumentList '--self-test' -NoNewWindow -Wait -PassThru
if ($selfCheck.ExitCode -ne 0) { throw 'Prototype self-check failed' }
Write-Host ('Built and checked: ' + $executable)
